# frozen_string_literal: true

# JSON-lines service for the Node side: one request per line on stdin, one
# response per line on stdout. Uses trmnlp itself for everything trmnlp does
# (settings.yml/.trmnlp.yml parsing, polling URL rendering and parsing, the
# serverless wrapper, the Liquid environment) so a test sees what trmnlp and
# the hosted service would.

PROTOCOL = $stdout.dup
$stdout.reopen($stderr)

require 'trmnlp'
require 'trmnlp/transform_backend/subprocess'
require 'active_support'
require 'active_support/time'
require 'json'
require 'open3'
require 'tmpdir'
require 'timeout'
require_relative 'mock_proxy'

# Liquid's 'now' and every Time.now during a render follow the test clock.
module FrozenNow
  def now(...)
    (t = Thread.current[:trmnlp_test_now]) ? t.dup : super
  end
end
Time.singleton_class.prepend(FrozenNow)

module TrmnlpTest
  CACHE = ENV.fetch('TRMNLP_TEST_CACHE', File.join(Dir.tmpdir, 'trmnlp-test'))
  LIBFAKETIME = Dir['/usr/lib/*/faketime/libfaketime.so.1'].first
  INTERPRETERS = { 'python' => 'python3', 'ruby' => 'ruby', 'node' => 'node', 'php' => 'php' }.freeze
  NON_VALUE_FIELDS = %w[author_bio copyable copyable_webhook_url].freeze

  class Plugin
    attr_reader :dir, :paths, :config

    def initialize(dir)
      @dir = File.expand_path(dir)
      @paths = TRMNLP::Paths.new(@dir)
      @config = TRMNLP::Config.new(@paths)
    end

    def settings = config.plugin.settings
    def trmnlp_yml = config.project.instance_variable_get(:@config) || {}

    def transform
      path, inferred = paths.transform_file
      return nil unless path

      { 'path' => path.to_s, 'language' => config.plugin.serverless_language || inferred }
    end

    def field_defaults
      config.plugin.custom_field_definitions.each_with_object({}) do |f, h|
        next if NON_VALUE_FIELDS.include?(f['field_type']) || !f.key?('default') || f['keyname'].nil?

        h[f['keyname']] = stringify(f['default'])
      end
    end

    def views = TRMNLP::Screen.names.select { |v| paths.template(v).exist? }

    def info
      fw = config.plugin.framework_version
      {
        'dir' => dir, 'name' => settings['name'], 'strategy' => config.plugin.strategy,
        'settings' => settings, 'fields' => config.plugin.custom_field_definitions,
        'fieldDefaults' => field_defaults, 'trmnlpYml' => trmnlp_yml,
        'transform' => transform, 'views' => views, 'hasShared' => paths.shared_template.exist?,
        'framework' => { 'number' => fw.number, 'pinned' => fw.pinned?, 'setting' => settings['framework_version'] },
        'frameworkVersions' => TRMNLP::FrameworkVersion.version_numbers,
        'frameworkLatest' => TRMNLP::FrameworkVersion.latest.number,
        'trmnlpVersion' => TRMNLP::VERSION
      }
    end

    # The same Liquid environment trmnlp renders with, custom filters included.
    def liquid_environment
      @liquid_environment ||= TRMNL::Liquid.new do |env|
        config.project.user_filters.each do |module_name, relative_path|
          require paths.root_dir.join(relative_path)
          env.register_filter(Object.const_get(module_name))
        end
      end
    end

    def stringify(value)
      case value
      when Array then value.map { |v| stringify(v) }
      when Hash then value.transform_values { |v| stringify(v) }
      else value.to_s
      end
    end
  end

  class Runner
    def initialize
      @plugins = {}
      @ca = CA.new(File.join(CACHE, 'ca-v1'))
    end

    def plugin(dir)
      key = File.expand_path(dir)
      # settings.yml / .trmnlp.yml are re-read every request: tests may run while files change
      @plugins[key] = Plugin.new(key)
    end

    def call(req)
      case req['op']
      when 'info' then plugin(req['plugin']).info
      when 'run' then run(req)
      when 'lint' then lint(req)
      when 'ping' then { 'pong' => true, 'trmnlp' => TRMNLP::VERSION }
      else raise ArgumentError, "unknown op #{req['op']}"
      end
    end

    # ------------------------------------------------------------------ run
    # Assembles the merge variables the way the hosted service does, runs the
    # serverless transform (unless disabled) and renders the requested views.
    def run(req)
      plugin = plugin(req['plugin'])
      now = req['now'] ? Time.at(req['now'].to_f).utc : Time.now.utc
      use_yml = req['trmnlpYml'] != false
      fields = custom_fields(plugin, req, use_yml)
      plugin.config.project.define_singleton_method(:custom_fields) { fields }
      strategy = req['strategy'] || plugin.config.plugin.strategy || 'webhook'
      table = MockTable.new(req['mocks'], req['network'])
      out = { 'strategy' => strategy, 'customFields' => fields, 'polling' => nil }

      trmnl = trmnl_namespace(plugin, req, fields, strategy, now)
      source = source_data(plugin, req, strategy, table, out)
      data = use_yml ? deep_merge(yml_variables(plugin), source) : source
      data['trmnl'] = trmnl
      out['mergeVariables'] = data

      tx = plugin.transform
      if tx && req['transform'] != false
        result = run_transform(plugin, tx, data, req, table, now)
        out['transform'] = result
        data = (result['output'].is_a?(Hash) ? result['output'] : data).dup
        data.delete('trmnl')
        out['nextState'] = data.delete('trmnl_state') if data.key?('trmnl_state')
        data['trmnl'] = trmnl
      else
        out['transform'] = { 'ran' => false, 'reason' => tx ? 'disabled' : 'no transform file', 'language' => tx&.dig('language') }
      end
      data = deep_merge(data, req['after']) if req['after'].is_a?(Hash)
      out['data'] = data
      out['views'] = (req['views'] || plugin.views).to_h { |v| [v, render_view(plugin, v, data, now, req['strictVariables'])] }
      out['requests'] = table.requests
      out
    end

    def custom_fields(plugin, req, use_yml)
      fields = plugin.field_defaults
      fields.merge!(plugin.stringify(plugin.trmnlp_yml['custom_fields'] || {})) if use_yml
      fields.merge!(plugin.stringify(req['fields'] || {}))
      fields
    end

    def yml_variables(plugin)
      vars = (plugin.trmnlp_yml['variables'] || {}).dup
      vars.delete('trmnl')
      vars
    end

    def trmnl_namespace(plugin, req, fields, strategy, now)
      t = req['trmnl'] || {}
      yml_trmnl = req['trmnlpYml'] == false ? {} : (plugin.trmnlp_yml.dig('variables', 'trmnl') || {})
      iana = t.dig('user', 'time_zone_iana') || yml_trmnl.dig('user', 'time_zone_iana') || plugin.config.project.time_zone
      tz = ActiveSupport::TimeZone.find_tzinfo(iana)
      user = {
        'id' => 1, 'name' => 'Jane Doe', 'first_name' => 'Jane', 'last_name' => 'Doe', 'locale' => 'en',
        'time_zone' => ActiveSupport::TimeZone::MAPPING.invert[tz.name] || tz.name,
        'time_zone_iana' => tz.name, 'utc_offset' => tz.period_for_utc(now).utc_total_offset
      }
      cfg = plugin.config.plugin
      settings = {
        'instance_name' => plugin.settings['name'] || 'Plugin',
        'refresh_interval_minutes' => cfg.refresh_interval, 'strategy' => strategy,
        'dark_mode' => cfg.dark_mode, 'no_screen_padding' => cfg.no_screen_padding,
        'custom_fields_values' => fields, 'data_fetched_utc' => now.to_i
      }
      if strategy == 'polling'
        settings['polling_url'] = cfg.polling_url_text
        settings['polling_headers'] = cfg.polling_headers_encoded
      end
      ns = {
        'user' => user, 'device' => req['device'] || {}, 'system' => { 'timestamp_utc' => now.to_i },
        'plugin_settings' => settings, 'state' => req['state'] || {}
      }
      ns = deep_merge(ns, yml_trmnl)
      ns = deep_merge(ns, t)
      ns['plugin_settings']['custom_fields_values'] = fields
      ns
    end

    # webhook / data: given by the test; static: settings.yml; polling: fetched
    # through the mocks with trmnlp's own URL rendering and response parsing.
    def source_data(plugin, req, strategy, table, out)
      return req['data'] || {} if req.key?('data')
      return req['webhook'] || {} if req.key?('webhook')

      case strategy
      when 'static' then plugin.config.plugin.static_data
      when 'polling' then poll(plugin, table, out)
      else req['webhook'] || {}
      end
    end

    Response = Struct.new(:status, :body, :headers)

    def poll(plugin, table, out)
      cfg = plugin.config.plugin
      urls = cfg.polling_urls
      verb = cfg.polling_verb.upcase
      headers = cfg.polling_headers
      body = verb == 'POST' ? cfg.polling_body : nil
      poller = TRMNLP::Poller.new(config: plugin.config, paths: plugin.paths, oauth_session: nil,
                                  reporter: TRMNLP::Reporter.new(quiet: true))
      out['polling'] = { 'urls' => urls, 'verb' => verb, 'headers' => headers, 'body' => body }
      responses = urls.map do |url|
        mock = table.find(verb, url)
        status, rheaders, rbody =
          if mock then MockResponse.build(mock)
          elsif table.live? then live_fetch(verb, url, headers, body)
          else MockResponse.unmocked(verb, url)
          end
        table.record('method' => verb, 'url' => url, 'headers' => headers, 'body' => body,
                     'mocked' => !mock.nil?, 'status' => status, 'via' => 'polling')
        poller.send(:parse_response, Response.new(status, rbody, rheaders.transform_keys(&:downcase)))
      end
      responses.size == 1 ? stringify_keys(responses.first) : responses.each_with_index.to_h { |r, i| ["IDX_#{i}", stringify_keys(r)] }
    end

    def live_fetch(verb, url, headers, body)
      conn = Faraday.new(url:, headers:)
      res = verb == 'POST' ? conn.post { |r| r.body = body } : conn.get
      [res.status, res.headers.to_h, res.body]
    end

    # ------------------------------------------------------------------ transform
    def run_transform(plugin, tx, data, req, table, now)
      language = tx['language']
      cmd = INTERPRETERS[language]
      return { 'ran' => false, 'language' => language, 'error' => "unsupported serverless_language: #{language}" } unless cmd

      input = data.merge('trmnl' => data['trmnl'].slice('user', 'device', 'plugin_settings', 'state'))
      timeout_s = (req['timeoutMs'] || 5000) / 1000.0
      proxy = MockProxy.new(ca: @ca, table:).start
      Dir.mktmpdir('trmnlp-test-tx-') do |dir|
        output_path = File.join(dir, 'output.json')
        src = File.join(dir, "transform.#{TRMNLP::TransformBackend::Subprocess::INTERPRETERS[language][:ext]}")
        sink = TRMNLP::TransformBackend::Subprocess.new.send(:sink_for, language, output_path)
        File.write(src, TRMNLP::TransformBackend::Wrapper.for(language, File.read(tx['path']), sink))
        mem_path = File.join(dir, 'mem')
        argv = ['/usr/bin/time', '-f', '%M', '-o', mem_path, cmd, *interpreter_flags(language), src]
        argv = argv.drop(5) unless File.executable?('/usr/bin/time')
        env = transform_env(language, proxy.port, now, dir, req)
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        stdout, stderr, status, timed_out = spawn_with_timeout(env, argv, JSON.generate(input), timeout_s, dir)
        duration = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
        raw = File.exist?(output_path) ? File.read(output_path) : ''
        result = {
          'ran' => true, 'language' => language, 'input' => input, 'stdout' => stdout, 'stderr' => stderr,
          'exitCode' => status&.exitstatus, 'durationMs' => duration, 'timedOut' => timed_out,
          'maxRssMb' => max_rss_mb(mem_path)
        }
        result['error'] =
          if timed_out then "timeout after #{timeout_s}s"
          elsif status && !status.success? then "transform exited #{status.exitstatus}: #{stderr.strip.lines.last(5).join}"
          end
        unless result['error']
          begin
            parsed = JSON.parse(raw)
            result['output'] = parsed.is_a?(Array) ? { 'data' => parsed } : parsed
          rescue JSON::ParserError => e
            result['error'] = "transform produced non-JSON output: #{e.message}"
          end
        end
        result
      end
    ensure
      proxy&.stop
    end

    def max_rss_mb(path)
      kb = File.exist?(path) ? File.read(path).lines.last.to_i : 0
      kb.positive? ? (kb / 1024.0).round(1) : nil
    end

    def interpreter_flags(language)
      return [] unless language == 'php'

      flags = ['-d', "curl.cainfo=#{@ca.bundle_path}", '-d', "openssl.cafile=#{@ca.bundle_path}"]
      autoload = ENV['TRMNLP_TEST_DEPS_PHP'] && File.join(ENV['TRMNLP_TEST_DEPS_PHP'], 'vendor', 'autoload.php')
      flags += ['-d', "auto_prepend_file=#{autoload}"] if autoload && File.exist?(autoload)
      flags
    end

    def transform_env(language, port, now, dir, req)
      proxy = "http://127.0.0.1:#{port}"
      env = {
        'PATH' => ENV.fetch('PATH'), 'HOME' => dir, 'LANG' => 'C.UTF-8', 'TZ' => 'UTC',
        'HTTP_PROXY' => proxy, 'HTTPS_PROXY' => proxy, 'http_proxy' => proxy, 'https_proxy' => proxy,
        'NO_PROXY' => '', 'no_proxy' => '', 'NODE_USE_ENV_PROXY' => '1',
        'NODE_EXTRA_CA_CERTS' => @ca.pem_path, 'SSL_CERT_FILE' => @ca.bundle_path,
        'REQUESTS_CA_BUNDLE' => @ca.bundle_path, 'CURL_CA_BUNDLE' => @ca.bundle_path
      }
      if req['freezeTime'] != false && LIBFAKETIME
        env['LD_PRELOAD'] = LIBFAKETIME
        env['FAKETIME'] = "@#{now.strftime('%Y-%m-%d %H:%M:%S')}"
        env['FAKETIME_DONT_FAKE_MONOTONIC'] = '1'
        env['FAKETIME_DONT_RESET'] = '1'
      end
      deps = ENV["TRMNLP_TEST_DEPS_#{language.upcase}"]
      case language
      when 'python' then env['PYTHONPATH'] = deps if deps
      when 'ruby' then env['GEM_PATH'] = [deps, Gem.default_dir].compact.join(':')
      when 'node' then env['NODE_PATH'] = File.join(deps, 'node_modules') if deps
      end
      env.merge((req['env'] || {}).transform_values(&:to_s))
    end

    def spawn_with_timeout(env, argv, stdin, timeout_s, dir)
      Open3.popen3(env, *argv, unsetenv_others: true, pgroup: true, chdir: dir) do |i, o, e, wait|
        out_reader = Thread.new { o.read }
        err_reader = Thread.new { e.read }
        begin
          i.write(stdin)
        rescue Errno::EPIPE
          nil
        end
        i.close
        if wait.join(timeout_s)
          [out_reader.value, err_reader.value, wait.value, false]
        else
          begin
            Process.kill('KILL', -wait.pid)
          rescue Errno::ESRCH
            nil
          end
          wait.join
          [out_reader.value, err_reader.value, nil, true]
        end
      end
    end

    # ------------------------------------------------------------------ liquid
    def render_view(plugin, view, data, now, strict)
      path = plugin.paths.template(view)
      return { 'markup' => '', 'error' => "Missing template: #{path}" } unless path.exist?

      shared = plugin.paths.shared_template
      source = (shared.exist? ? shared.read : '') + path.read
      Thread.current[:trmnlp_test_now] = now
      template = Liquid::Template.parse(source, environment: plugin.liquid_environment)
      markup = template.render(data, strict_variables: strict ? true : false)
      errors = template.errors.map(&:to_s)
      { 'markup' => markup, 'error' => nil, 'warnings' => errors }
    rescue StandardError => e
      { 'markup' => e.message, 'error' => e.message }
    ensure
      Thread.current[:trmnlp_test_now] = nil
    end

    # ------------------------------------------------------------------ lint
    def lint(req)
      out, status = Open3.capture2e('trmnlp', 'lint', '-d', File.expand_path(req['plugin']))
      issues = out.lines.filter_map { |l| l[/\A\s*\d+\.\s+(.*)/, 1]&.strip }
      { 'ok' => status.success?, 'exitCode' => status.exitstatus, 'output' => out, 'issues' => issues }
    end

    # ------------------------------------------------------------------ util
    def deep_merge(a, b)
      return b unless a.is_a?(Hash) && b.is_a?(Hash)

      a.merge(b) { |_, x, y| deep_merge(x, y) }
    end

    def stringify_keys(obj)
      case obj
      when Hash then obj.to_h { |k, v| [k.to_s, stringify_keys(v)] }
      when Array then obj.map { |v| stringify_keys(v) }
      else obj
      end
    end
  end
end

runner = TrmnlpTest::Runner.new
PROTOCOL.sync = true
PROTOCOL.puts(JSON.generate({ 'ready' => true, 'trmnlp' => TRMNLP::VERSION }))
$stdin.each_line do |line|
  req = JSON.parse(line)
  begin
    PROTOCOL.puts(JSON.generate({ 'id' => req['id'], 'ok' => true, 'result' => runner.call(req) }))
  rescue StandardError, ScriptError => e
    PROTOCOL.puts(JSON.generate({ 'id' => req['id'], 'ok' => false, 'error' => "#{e.class}: #{e.message}",
                                  'backtrace' => e.backtrace&.first(8) }))
  end
end
