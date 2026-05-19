# Robot webapp deploy targets
# Usage:
#   make deploy-a     Deploy webapp for robot_a
#   make deploy-b     Deploy webapp for robot_b
#   make deploy-all   Deploy both

ROBOT_A_SIGNALING_URL = wss://utsavchaudhary.us
ROBOT_A_PAGES_PROJECT = robot-control

ROBOT_B_SIGNALING_URL = wss://robot-b.utsavchaudhary.us
ROBOT_B_PAGES_PROJECT = robot-control-b

.PHONY: build-a build-b deploy-a deploy-b deploy-all dev

build-a:
	VITE_SIGNALING_URL=$(ROBOT_A_SIGNALING_URL) npm run build

build-b:
	VITE_SIGNALING_URL=$(ROBOT_B_SIGNALING_URL) npm run build

deploy-a: build-a
	wrangler pages deploy dist --project-name $(ROBOT_A_PAGES_PROJECT) --commit-dirty=true

deploy-b: build-b
	wrangler pages deploy dist --project-name $(ROBOT_B_PAGES_PROJECT) --commit-dirty=true

deploy-all: deploy-a deploy-b

dev:
	npm run dev
