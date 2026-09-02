# Crewly API

## How to get started
1. Clone the project into the project folder `crewly/`.
2. Run `npm i`.
3. Request for local `secrets.zip` and extract it into the root of `crewly-api`.
4. Install Docker Desktop and run `docker compose up --build` to start it. You must also build or request for `docker-compose.yml` and place it at the root of the project folder.

## Development Flow
1. Update or add endpoints in `routes/`.
2. Update or add tests in `tests/`. Run `npm test` to see all test cases pass.
3. Push a feature branch to the repository and complete a pull request. It will be merged if all test cases pass and description is adequate.