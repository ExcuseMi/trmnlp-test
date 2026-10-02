# trmnlp-test: trmnlp (Liquid, transform harness) + Chromium (Playwright) + the four
# serverless runtimes with package managers, libfaketime and zbar.
ARG TRMNLP_VERSION=0.13.1
FROM node:24-trixie-slim AS node
FROM trmnl/trmnlp:v${TRMNLP_VERSION}
LABEL org.opencontainers.image.source=https://github.com/ExcuseMi/trmnlp-test \
      org.opencontainers.image.description="Test framework for TRMNL plugins" \
      org.opencontainers.image.licenses=MIT

# Node 24: Playwright, and NODE_USE_ENV_PROXY so serverless fetch() goes through the mock proxy
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && rm -f /usr/bin/node

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-pip php-cli php-curl php-mbstring php-xml php-zip composer unzip \
      faketime libfaketime time zbar-tools ca-certificates git build-essential \
 && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /opt/trmnlp-test
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY . .
RUN ln -s /opt/trmnlp-test/src/cli.js /usr/local/bin/trmnlp-test && chmod +x src/cli.js \
 && mkdir -p /cache && chmod 777 /cache

ENV NODE_PATH=/opt/trmnlp-test/node_modules:/opt \
    TRMNLP_LIB=/app/lib BUNDLE_GEMFILE=/app/Gemfile \
    TRMNLP_TEST_CACHE=/cache \
    HOME=/tmp/home
WORKDIR /work
ENTRYPOINT ["trmnlp-test"]
CMD ["run"]
