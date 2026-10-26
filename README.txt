LUMS PAD MACHINES — SHARED SERVER SETUP
=======================================

WHAT THIS VERSION DOES
- Restores the role-selection pop-up: Student / Visitor or In-charge.
- Students/visitors can submit complaints without signing in.
- In-charge mode requires a password configured on the server laptop.
- In-charge can mark complaints resolved.
- Complaints and machine statuses are saved centrally in data.json, not in each visitor's browser.
- Every open browser refreshes shared status/complaints about every 5 seconds.
- No Claude account or Claude-specific API is required.

REQUIREMENT
Install Node.js (current LTS) on the laptop that will host the website. No npm packages are needed.
Official installer: https://nodejs.org/

WINDOWS SETUP
1. Put these two files in the same folder:
   - LUMS_Pad_Machines_fixed.html
   - server.js

2. Open PowerShell in that folder.

3. Set an in-charge password (use your own long, unique password):
   $env:IN_CHARGE_PASSWORD="replace-this-with-a-long-unique-password"

4. Start the server:
   node server.js

5. On the host laptop, open this address in a browser:
   http://localhost:8080

6. To find the laptop's Wi-Fi/LAN IPv4 address, open another PowerShell window and run:
   ipconfig
   Find the IPv4 Address under the Wi-Fi adapter, for example 192.168.1.23.

7. Other people connected to the same Wi-Fi can then open:
   http://192.168.1.23:8080
   Replace the example IP with the laptop's actual IPv4 address.

8. If Windows Firewall asks, allow Node.js on private networks. Do not open it to public networks unless you understand the security implications.

IMPORTANT
- Keep the laptop powered on, connected to the network, and keep the server terminal running. If the laptop sleeps or the server stops, the website will stop syncing.
- The data.json file is created automatically after the first complaint. Back it up regularly; it contains the shared complaint/status data.
- The in-charge password is configured on the server, not in the HTML. Do not share it with students.
- This setup is intended for access on the same trusted Wi-Fi/LAN. Do NOT expose this plain-HTTP server directly to the public internet or configure router port-forwarding for it. For access from anywhere, use a properly secured HTTPS deployment/reverse proxy or a hosted server.
- If a browser cannot reach the server, make sure it is opening the server URL (http://HOST-IP:8080), not opening the HTML file directly from Downloads. The API and shared sync require the server URL.

STOPPING
Press Ctrl+C in the terminal running node server.js.
