# Convenience aliases for the same npm scripts used by Windows CI.
ifeq ($(wildcard go.mod),)
  $(error 在包含 go.mod 的项目目录中运行 make)
endif

NPM ?= npm
RUN ?=

.PHONY: help setup build lint fmt fmt-check test test-one verify clean

help:
	@echo "make verify  =  npm run verify"
	@echo "make setup   =  npm run setup"
	@echo "make build   =  npm run build"

setup:
	$(NPM) run setup

build:
	$(NPM) run build

lint:
	$(NPM) run build:frontend
	$(NPM) run lint

fmt:
	$(NPM) run format

fmt-check:
	$(NPM) run format:check

test:
	$(NPM) test

test-one:
	$(NPM) run build:frontend
	$(NPM) run build:smoke
	node --test --test-name-pattern="$(RUN)" tests/desktop.test.mjs

verify:
	$(NPM) run verify

clean:
	$(NPM) run clean
