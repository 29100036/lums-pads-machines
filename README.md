# lums pad machines

a web-based reporting system for pad machines at lums. students can report machine problems without signing in, while the in-charge can log in to view complaints and mark them as resolved.

## about the project

the purpose of this project is to make reporting problems with pad machines easier and help ensure that reported issues can be addressed promptly.

### features

- submit complaints without a student account
- report the machine and describe the issue
- view submitted complaints through the in-charge interface
- allow the in-charge to log in and resolve complaints
- store complaint and machine status data in supabase
- deploy the website using render

## technology stack

- **frontend:** html, css and javascript
- **backend:** node.js
- **hosting:** render
- **database:** supabase

## hosting and database

### render

render hosts the website and runs the node.js server.

the application is deployed from this github repository. when changes are pushed to the connected branch, render can automatically deploy the updated version.

the following environment variables must be configured in render:

- `in_charge_password` — the password used for the in-charge login, if referenced by the application under this name
- `supabase_url` — the url of the supabase project
- `supabase_service_role_key` — the private server-side key used to authenticate database requests, if this is the variable name configured in the server

**important:** environment variable names are case-sensitive. use the exact names expected by `server.js`. keep private keys in render's environment settings and never expose them in frontend code or commit them to github.

### supabase

supabase stores the application's complaint and machine status data.

the database includes these tables:

- `reports` — stores complaint details, submission times, and resolution information
- `machine_status` — stores machine status and related timestamps

the database tables must have the column names and data types expected by the backend.

## original database connection issue

the application initially returned a `401` error when a student tried to submit a complaint.

the cause was that render was configured with the public supabase api key instead of the private server-side key required by the application's database requests.

the issue was resolved by replacing the public key in render with the appropriate private key. after the environment variable was updated, complaint submission started working.

## security

- never publish the private supabase key.
- never put server-side secrets in `index.html` or other browser-accessible files.
- keep the in-charge password in render's environment settings.
- use the minimum necessary permissions and protect access to the database.

## local development

1. clone this repository.
2. install node.js if it is not already installed.
3. configure the required environment variables.
4. install any dependencies specified in `package.json`, if required.
5. start the server using the command configured for the project.

check `package.json` and `server.js` for the exact startup command and environment variable names.

## project goal

to provide a simple and accessible way for students to report pad machine problems at lums and help the responsible staff track and resolve them.