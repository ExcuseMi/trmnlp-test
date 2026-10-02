# frozen_string_literal: true

require_relative 'lib/trmnlp_test/version'

Gem::Specification.new do |spec|
  spec.name = 'trmnlp-test'
  spec.version = TrmnlpTest::VERSION
  spec.authors = ['ExcuseMi']
  spec.summary = 'Test framework for TRMNL plugins (trmnlp projects, serverless, webhooks, every device)'
  spec.description = 'Runs Playwright tests against TRMNL plugins in the trmnlp format: webhook, polling, ' \
                     'static and serverless transforms (Python, Ruby, Node, PHP) with mocked HTTP and a frozen ' \
                     'clock, on every TRMNL device model and framework version. The launcher runs the ' \
                     'ghcr.io/excusemi/trmnlp-test Docker image.'
  spec.homepage = 'https://github.com/ExcuseMi/trmnlp-test'
  spec.license = 'MIT'
  spec.required_ruby_version = '>= 3.0'
  spec.files = Dir['exe/*', 'lib/**/*.rb', 'README.md', 'LICENSE']
  spec.bindir = 'exe'
  spec.executables = ['trmnlp-test']
  spec.metadata = { 'source_code_uri' => spec.homepage, 'rubygems_mfa_required' => 'true' }
end
