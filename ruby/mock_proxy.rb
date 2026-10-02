# frozen_string_literal: true

require 'openssl'
require 'socket'
require 'uri'
require 'net/http'
require 'json'
require 'fileutils'

module TrmnlpTest
  # A local CA whose certificate the transform runtimes are told to trust, so the
  # mock proxy can answer HTTPS requests for any host.
  class CA
    attr_reader :pem_path, :bundle_path

    def initialize(dir)
      FileUtils.mkdir_p(dir)
      @pem_path = File.join(dir, 'ca.pem')
      key_path = File.join(dir, 'ca.key')
      @bundle_path = File.join(dir, 'bundle.pem')
      # one CA for every worker: the first creates it under a lock, the rest wait and read it
      File.open(File.join(dir, 'ca.lock'), File::RDWR | File::CREAT, 0o644) do |lock|
        lock.flock(File::LOCK_EX)
        unless File.exist?(@pem_path) && File.exist?(key_path)
          key = OpenSSL::PKey::RSA.new(2048)
          cert = build_cert(key, key, '/CN=trmnlp-test mock CA', ca: true)
          atomic_write(key_path, key.to_pem)
          atomic_write(@pem_path, cert.to_pem)
        end
        @key = OpenSSL::PKey::RSA.new(File.read(key_path))
        @cert = OpenSSL::X509::Certificate.new(File.read(@pem_path))
        system_bundle = ['/etc/ssl/certs/ca-certificates.crt'].find { |f| File.exist?(f) }
        atomic_write(@bundle_path, (system_bundle ? File.read(system_bundle) : '') + "\n" + File.read(@pem_path))
      end
      @leaf_key = OpenSSL::PKey::RSA.new(2048)
      @contexts = {}
      @lock = Mutex.new
    end

    def context_for(host)
      @lock.synchronize do
        @contexts[host] ||= begin
          ctx = OpenSSL::SSL::SSLContext.new
          ctx.cert = build_cert(@leaf_key, @key, "/CN=#{host}", host: host, issuer: @cert)
          ctx.key = @leaf_key
          ctx
        end
      end
    end

    private

    def atomic_write(path, body)
      tmp = "#{path}.#{Process.pid}.tmp"
      File.write(tmp, body)
      File.rename(tmp, path)
    end

    def build_cert(key, signing_key, subject, ca: false, host: nil, issuer: nil)
      cert = OpenSSL::X509::Certificate.new
      cert.version = 2
      cert.serial = rand(2**64)
      cert.subject = OpenSSL::X509::Name.parse(subject)
      cert.issuer = issuer ? issuer.subject : cert.subject
      cert.public_key = key.public_key
      cert.not_before = Time.at(0)
      cert.not_after = Time.utc(2099, 1, 1)
      ef = OpenSSL::X509::ExtensionFactory.new
      ef.subject_certificate = cert
      ef.issuer_certificate = issuer || cert
      cert.add_extension(ef.create_extension('subjectKeyIdentifier', 'hash', false))
      cert.add_extension(ef.create_extension('authorityKeyIdentifier', 'keyid:always', false))
      if ca
        cert.add_extension(ef.create_extension('basicConstraints', 'CA:TRUE', true))
        cert.add_extension(ef.create_extension('keyUsage', 'keyCertSign,cRLSign', true))
      else
        san = host =~ /\A[\d.]+\z/ ? "IP:#{host}" : "DNS:#{host}"
        cert.add_extension(ef.create_extension('subjectAltName', san, false))
        cert.add_extension(ef.create_extension('extendedKeyUsage', 'serverAuth', false))
      end
      cert.sign(signing_key, OpenSSL::Digest.new('SHA256'))
      cert
    end
  end

  # Matches requests against the test's mocks and records every request made.
  class MockTable
    attr_reader :requests

    attr_reader :callback
    attr_accessor :clock

    # callback: answers a computed mock (one with 'dynamic', its respond function lives in Node)
    def initialize(mocks, network, callback: nil)
      @callback = callback
      @clock = nil
      @mocks = (mocks || []).map { |m| m.merge('used' => 0) }
      @network = network || 'mock'
      @requests = []
      @lock = Mutex.new
    end

    def live? = @network == 'live'

    # A regex or wildcard pattern may match any host, so it intercepts all of them
    # (unmatched requests are still forwarded in live mode).
    def host_mocked?(host)
      @mocks.any? do |m|
        url = m['url']
        url.start_with?('/') || url.include?('*') || (URI(url).host rescue nil) == host
      end
    end

    # => [mock or nil]
    def find(method, url)
      @lock.synchronize do
        mock = @mocks.find { |m| matches?(m, method, url) && (m['times'].nil? || m['used'] < m['times']) }
        mock['used'] += 1 if mock
        mock
      end
    end

    def record(entry) = @lock.synchronize { @requests << entry }

    def advance_clock?(mock) = mock['advanceClockMs'].to_f.positive?

    # Moves the transform's frozen clock forward (a mock's advanceClockMs, whole seconds): the
    # runtime reads its time from clock.file, written atomically so it never sees half a line.
    def advance_clock(ms)
      return unless @clock

      @lock.synchronize do
        @clock[:offset] += ms.to_f / 1000
        time = Time.at(@clock[:base].to_f + @clock[:offset]).utc
        tmp = "#{@clock[:file]}.tmp"
        File.write(tmp, "@#{time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        File.rename(tmp, @clock[:file])
      end
    end

    private

    def matches?(mock, method, url)
      return false if mock['method'] && mock['method'].upcase != method.upcase

      pattern = mock['url']
      if pattern.start_with?('/') && pattern.end_with?('/') && pattern.length > 1
        Regexp.new(pattern[1..-2]).match?(url)
      else
        target = pattern.include?('?') ? url : url.split('?', 2).first
        regex = Regexp.new("\\A#{Regexp.escape(pattern).gsub('\\*', '.*')}\\z")
        regex.match?(target)
      end
    end
  end

  # Turns a mock into [status, headers, body].
  module MockResponse
    module_function

    # A computed mock asks Node for its answer, with the request; the answer has the shape of a mock.
    def resolve(mock, table, request)
      return mock unless mock['dynamic']

      answer = table.callback.call(mock['dynamic'], request) || {}
      answer.merge('dynamic' => nil)
    end

    def build(mock)
      headers = (mock['headers'] || {}).dup
      body = if mock.key?('json')
               headers['content-type'] ||= 'application/json'
               JSON.generate(mock['json'])
             elsif mock['bodyBase64']
               mock['bodyBase64'].unpack1('m0')
             else
               mock['body'].to_s
             end
      headers['content-type'] ||= 'text/plain; charset=utf-8'
      [mock['status'] || 200, headers, body]
    end

    def unmocked(method, url)
      [599, { 'content-type' => 'text/plain' },
       "trmnlp-test: no mock for #{method} #{url} (add a mock, or set network: 'live')"]
    end
  end

  # An HTTP(S) proxy the transform runs behind (HTTP(S)_PROXY). HTTPS is
  # intercepted with certificates from CA, so mocks work for every language and
  # library that honours the proxy variables.
  class MockProxy
    attr_reader :port

    def initialize(ca:, table:)
      @ca = ca
      @table = table
    end

    def start
      @server = TCPServer.new('127.0.0.1', 0)
      @port = @server.addr[1]
      @thread = Thread.new do
        loop do
          sock = @server.accept
          Thread.new(sock) { |s| handle(s) }
        rescue IOError, Errno::EBADF
          break
        end
      end
      self
    end

    def stop
      @server&.close
      @thread&.join(1)
    end

    private

    def handle(sock)
      line = sock.gets
      return unless line

      method, target, = line.split(' ')
      headers, raw = read_headers(sock)
      if method == 'CONNECT'
        connect(sock, target)
      else
        body = read_body(sock, headers)
        respond(sock, method, target, headers, body, raw)
      end
    rescue StandardError => e
      warn "trmnlp-test proxy: #{e.class}: #{e.message}"
    ensure
      sock.close rescue nil
    end

    def connect(sock, target)
      host, port = target.split(':')
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if @table.live? && !@table.host_mocked?(host)
        tunnel(sock, TCPSocket.new(host, port.to_i))
        return
      end
      ssl = OpenSSL::SSL::SSLSocket.new(sock, @ca.context_for(host))
      ssl.sync_close = true
      ssl.accept
      line = ssl.gets
      return unless line

      method, path, = line.split(' ')
      headers, raw = read_headers(ssl)
      body = read_body(ssl, headers)
      url = "https://#{host}#{port.to_i == 443 ? '' : ":#{port}"}#{path}"
      respond(ssl, method, url, headers, body, raw)
      ssl.close rescue nil
    end

    def tunnel(a, b)
      t = Thread.new { IO.copy_stream(b, a) rescue nil; a.close_write rescue nil }
      IO.copy_stream(a, b) rescue nil
      b.close_write rescue nil
      t.join(30)
    ensure
      b.close rescue nil
    end

    def respond(io, method, url, headers, body, raw = [])
      entry = { 'method' => method, 'url' => url, 'headers' => headers, 'rawHeaders' => raw, 'body' => body }
      mock = @table.find(method, url)
      mock = MockResponse.resolve(mock, @table, entry.dup) if mock
      if mock
        if mock['delayMs'] && gone?(io, mock['delayMs'] / 1000.0)
          @table.record(entry.merge('mocked' => true, 'status' => nil, 'aborted' => true))
          return
        end
        @table.advance_clock(mock['advanceClockMs']) if @table.advance_clock?(mock)
        if mock['error'] == 'reset'
          @table.record(entry.merge('mocked' => true, 'status' => nil, 'error' => 'reset'))
          return
        end
        status, resp_headers, resp_body = MockResponse.build(mock)
      elsif @table.live?
        status, resp_headers, resp_body = forward(method, url, headers, body)
      else
        status, resp_headers, resp_body = MockResponse.unmocked(method, url)
      end
      aborted = write_response(io, status, resp_headers, resp_body, body_delay: mock && mock['bodyDelayMs'])
      @table.record(entry.merge('mocked' => !mock.nil?, 'status' => status, **(aborted ? { 'aborted' => true } : {})))
    end

    # Waits `seconds`, and answers whether the client gave up meanwhile (its timeout or abort
    # signal closed the connection). With one request per connection, anything readable on the
    # socket after the request is the client leaving.
    def gone?(io, seconds)
      tcp = io.respond_to?(:to_io) ? io.to_io : io
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + seconds
      loop do
        left = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
        return false if left <= 0
        return true if IO.select([tcp], nil, nil, [left, 0.05].min)
      end
    end

    def forward(method, url, headers, body)
      uri = URI(url)
      req = Net::HTTPGenericRequest.new(method, !body.to_s.empty?, true, uri.request_uri)
      headers.each { |k, v| req[k] = v unless %w[host connection proxy-connection accept-encoding].include?(k) }
      req.body = body unless body.to_s.empty?
      res = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 10, read_timeout: 30) { |h| h.request(req) }
      hdrs = {}
      res.each_header { |k, v| hdrs[k] = v unless %w[transfer-encoding content-length connection content-encoding].include?(k) }
      [res.code.to_i, hdrs, res.body.to_s]
    rescue StandardError => e
      [502, { 'content-type' => 'text/plain' }, "trmnlp-test: live request failed: #{e.message}"]
    end

    # body_delay: the headers go out at once, the body after that many ms (a slow server).
    # => true when the client gave up before the body was sent
    def write_response(io, status, headers, body, body_delay: nil)
      body = body.b
      out = +"HTTP/1.1 #{status} #{status_text(status)}\r\n"
      headers.each { |k, v| out << "#{k}: #{v}\r\n" }
      out << "content-length: #{body.bytesize}\r\nconnection: close\r\n\r\n"
      if body_delay
        io.write(out.b)
        io.flush
        return true if gone?(io, body_delay / 1000.0)

        io.write(body)
      else
        io.write(out.b + body)
      end
      io.flush
      false
    rescue IOError, SystemCallError
      true
    end

    def status_text(status) = Net::HTTPResponse::CODE_TO_OBJ[status.to_s]&.name&.sub('Net::HTTP', '') || 'Status'

    # => [headers by lower-case name (HTTP names are case-insensitive), [[name, value]] as sent]
    def read_headers(io)
      headers = {}
      raw = []
      while (line = io.gets) && line != "\r\n" && line != "\n"
        k, v = line.split(':', 2)
        raw << [k.strip, v.to_s.strip]
        headers[k.strip.downcase] = v.to_s.strip
      end
      [headers, raw]
    end

    def read_body(io, headers)
      if (len = headers['content-length'])
        io.read(len.to_i).to_s
      elsif headers['transfer-encoding'].to_s.include?('chunked')
        body = +''
        while (size = io.gets.to_s.strip.to_i(16)).positive?
          body << io.read(size)
          io.gets
        end
        io.gets
        body
      else
        ''
      end
    end
  end
end
