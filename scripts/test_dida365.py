import base64
import json
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

CLIENT_ID = "m5iR14msV0KXA5fDYt"
CLIENT_SECRET = "QsjOxN217ijYZAPOH4GnZJxiyCVdp7s1"
REDIRECT_URI = "http://127.0.0.1:8765/callback"
SCOPE = "tasks:read tasks:write"
PORT = 8765

code_holder = {"code": None, "error": None}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        if "code" in params:
            code_holder["code"] = params["code"][0]
            body = b"<h1>OK, you can close this tab</h1>"
            status = 200
        else:
            code_holder["error"] = params.get("error", ["unknown"])[0]
            body = b"<h1>Auth failed</h1>"
            status = 400
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def post_form(url, data, headers=None):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def get_json(url, token):
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    auth_url = (
        "https://dida365.com/oauth/authorize?"
        + urllib.parse.urlencode(
            {
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT_URI,
                "response_type": "code",
                "scope": SCOPE,
                "state": "orbita-test",
            }
        )
    )

    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"1) Opening browser for authorization...")
    print(f"   {auth_url}")
    webbrowser.open(auth_url)
    print(f"2) Waiting for callback on {REDIRECT_URI} ...")
    server.handle_request()

    if code_holder["error"]:
        raise SystemExit(f"OAuth error: {code_holder['error']}")
    if not code_holder["code"]:
        raise SystemExit("No authorization code received")

    print("3) Exchanging code for token...")
    basic = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    token_resp = post_form(
        "https://dida365.com/oauth/token",
        {
            "code": code_holder["code"],
            "grant_type": "authorization_code",
            "scope": SCOPE,
            "redirect_uri": REDIRECT_URI,
        },
        {"Authorization": f"Basic {basic}"},
    )
    token = token_resp.get("access_token")
    if not token:
        raise SystemExit(f"Token exchange failed: {token_resp}")

    print("4) Calling GET /open/v1/project ...")
    projects = get_json("https://api.dida365.com/open/v1/project", token)
    print("SUCCESS")
    print(f"projects: {len(projects)}")
    for p in projects[:5]:
        print(f"  - {p.get('name')} ({p.get('id')})")
    if len(projects) > 5:
        print(f"  ... and {len(projects) - 5} more")


if __name__ == "__main__":
    main()
