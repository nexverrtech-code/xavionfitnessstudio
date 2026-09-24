"""Create the first admin account (prints SQL; nothing is sent anywhere).

    python scripts/create_admin.py --email owner@gymname.com --name "Gym Owner" > admin.sql
    npx wrangler d1 execute smartgym-db --remote --file=admin.sql
    del admin.sql   (or rm admin.sql)

You are asked for the admin password and for the AUTH_SECRET you stored as a Worker secret
(passwords are peppered with it). Neither is passed on the command line or written anywhere;
only the resulting hash is printed. Alternatively set the SETUP_TOKEN secret and use the
/setup page once.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from security.passwords import hash_password_sync, password_problem  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True, help="email used to sign in")
    parser.add_argument("--name", required=True)
    parser.add_argument("--iterations", type=int, default=20_000, help="must match PASSWORD_ITERATIONS (default 20000)")
    args = parser.parse_args()
    password = getpass.getpass("Admin password: ")
    problem = password_problem(password)
    if problem:
        sys.exit(f"Password rejected: {problem}")
    if getpass.getpass("Repeat password: ") != password:
        sys.exit("Passwords do not match.")
    secret = getpass.getpass("AUTH_SECRET (the value you set with `wrangler secret put AUTH_SECRET`): ")
    if len(secret) < 32:
        sys.exit("AUTH_SECRET must be at least 32 characters.")
    email = args.email.strip().lower().replace("'", "")
    name = args.name.strip().replace("'", "''")
    password_hash = hash_password_sync(password, secret=secret, iterations=args.iterations)
    print(f"INSERT INTO users (role_id, name, email, password_hash) VALUES (1, '{name}', '{email}', '{password_hash}');")


if __name__ == "__main__":
    main()
