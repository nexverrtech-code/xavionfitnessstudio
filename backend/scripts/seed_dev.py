"""DEVELOPMENT-ONLY demo data for SmartGym.

    python scripts/seed_dev.py > seed/dev_seed.sql
    npx wrangler d1 execute smartgym-db --local --file=seed/dev_seed.sql

Password hashes use the AUTH_SECRET pepper of the local Worker: taken from --auth-secret, the
AUTH_SECRET environment variable, or backend/.dev.vars (in that order).

NEVER run this against production: it creates fake members, payments and logins with
well-known passwords. Production metrics always come from real data only.
"""

from __future__ import annotations

import argparse
import os
import random
import secrets
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from core.config import DEV_AUTH_SECRET  # noqa: E402
from security.passwords import hash_password_sync  # noqa: E402

IST = timezone(timedelta(minutes=330))
FIRST = [
    "Aarav", "Vivaan", "Aditya", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Rohan", "Kabir", "Mohammed", "Farhan",
    "Rahul", "Karthik", "Siddharth", "Ananya", "Diya", "Priya", "Aisha", "Meera", "Kavya", "Sneha", "Pooja", "Riya",
    "Fatima", "Zara", "Nisha", "Lakshmi", "Divya", "Harini", "Vikram", "Naveen", "Suresh", "Deepak", "Imran", "Ayesha",
]
LAST = [
    "Sharma", "Verma", "Iyer", "Nair", "Reddy", "Patel", "Khan", "Singh", "Gupta", "Menon", "Rao", "Das", "Joshi",
    "Kulkarni", "Pillai", "Shaikh", "Mehta", "Chopra", "Bose", "Bhat", "Hussain", "Krishnan", "Naidu", "Pandey",
]
PLANS = [("Monthly", 30, 150000, "Full gym access for 30 days"), ("Quarterly", 90, 400000, "Best for building a habit"),
         ("Half Yearly", 180, 750000, "Six months with 1 free PT session"), ("Yearly", 365, 1300000, "Our best value plan")]
TRAINERS = [("Arjun Menon", "Strength & Conditioning"), ("Sneha Kulkarni", "Weight Loss & HIIT"), ("Imran Shaikh", "Bodybuilding")]
WORKOUTS = {
    "Chest + Triceps": [("Bench Press", 4, "10", 60, 90), ("Incline Dumbbell Press", 3, "12", 20, 75), ("Cable Fly", 3, "15", 15, 60), ("Tricep Pushdown", 3, "12", 25, 60)],
    "Back + Biceps": [("Deadlift", 4, "6", 100, 120), ("Lat Pulldown", 3, "12", 50, 75), ("Seated Row", 3, "12", 45, 75), ("Barbell Curl", 3, "10", 25, 60)],
    "Legs + Core": [("Back Squat", 4, "8", 80, 120), ("Leg Press", 3, "12", 150, 90), ("Walking Lunges", 3, "20", 12, 60), ("Plank", 3, "60s", None, 45)],
    "Full Body Fat Burn": [("Kettlebell Swing", 4, "15", 16, 45), ("Burpees", 4, "12", None, 45), ("Rowing Machine", 3, "500m", None, 60), ("Mountain Climbers", 3, "30s", None, 30)],
}
EXPENSES = [("RENT", 4500000, "Monthly rent"), ("ELECTRICITY", 850000, "Electricity bill"), ("SALARY", 9000000, "Trainer & staff salaries"),
            ("MAINTENANCE", 250000, "Equipment servicing"), ("MARKETING", 300000, "Instagram ads")]
METHODS = ["UPI"] * 5 + ["CASH"] * 3 + ["CARD_MANUAL"] + ["BANK_TRANSFER"]


def q(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def ts(d: date, hour: int, minute: int = 0) -> str:
    """Local IST wall-clock -> stored UTC timestamp."""
    return datetime.combine(d, time(hour, minute), tzinfo=IST).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def hour_until_now(rng: random.Random, d: date, today: date, lo: int, hi: int) -> int:
    """A random hour of the day, but not after the seed's 09:00 "now" on today's date."""
    return rng.randint(min(lo, 8), 8) if d == today else rng.randint(lo, hi)


def auth_secret(cli_value: str | None) -> str:
    if cli_value:
        return cli_value
    if os.environ.get("AUTH_SECRET"):
        return os.environ["AUTH_SECRET"]
    dev_vars = ROOT / ".dev.vars"
    if dev_vars.exists():
        for line in dev_vars.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("AUTH_SECRET="):
                return line.split("=", 1)[1].strip()
    return DEV_AUTH_SECRET


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--members", type=int, default=64)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--today", type=date.fromisoformat, default=datetime.now(IST).date())
    parser.add_argument("--auth-secret", default=None)
    parser.add_argument("--iterations", type=int, default=20_000)
    args = parser.parse_args()
    rng = random.Random(args.seed)
    today: date = args.today
    secret = auth_secret(args.auth_secret)
    out: list[str] = ["-- SmartGym DEVELOPMENT seed data. Do NOT load into production."]

    def insert(table: str, row: dict) -> None:
        out.append(f"INSERT INTO {table} ({', '.join(row)}) VALUES ({', '.join(q(v) for v in row.values())});")

    def pw(text: str) -> str:
        return hash_password_sync(text, secret=secret, iterations=args.iterations)

    now = ts(today, 9)
    for key, value in (("gym_name", "SmartGym Fitness"), ("gym_address", "2nd Floor, MG Road, Bengaluru 560001"),
                       ("gym_phone", "+91 80 4000 1234"), ("gym_email", "hello@smartgym.local"), ("upi_id", "smartgym@okaxis"),
                       ("upi_name", "SmartGym Fitness")):
        insert("settings", {"key": key, "value": value, "updated_at": now})

    passwords = {"admin": "Admin@123", "staff": "Desk@1234", "trainer": "Coach@1234", "member": "Member@123"}
    insert("users", {"id": 1, "role_id": 1, "name": "Admin", "email": "admin@smartgym.local", "password_hash": pw(passwords["admin"]),
                     "created_at": now, "updated_at": now})
    insert("users", {"id": 2, "role_id": 2, "name": "Front Desk", "email": "desk@smartgym.local", "password_hash": pw(passwords["staff"]),
                     "created_at": now, "updated_at": now})
    insert("users", {"id": 3, "role_id": 3, "name": TRAINERS[0][0], "password_hash": pw(passwords["trainer"]), "created_at": now,
                     "updated_at": now})
    insert("users", {"id": 4, "role_id": 4, "name": "Aarav Sharma", "password_hash": pw(passwords["member"]), "created_at": now,
                     "updated_at": now})

    for pid, (name, days, price, desc) in enumerate(PLANS, start=1):
        insert("membership_plans", {"id": pid, "name": name, "duration_days": days, "price": price, "description": desc,
                                    "status": "ACTIVE", "created_at": ts(today - timedelta(days=300), 10), "updated_at": now})
    for tid, (name, spec) in enumerate(TRAINERS, start=1):
        insert("trainers", {"id": tid, "user_id": 3 if tid == 1 else None, "name": name, "phone": f"98450{tid:05d}",
                            "email": f"trainer{tid}@smartgym.local", "specialization": spec,
                            "joining_date": (today - timedelta(days=400 - tid * 30)).isoformat(), "status": "ACTIVE",
                            "created_at": ts(today - timedelta(days=400), 10), "updated_at": now})

    membership_id = attendance_id = plan_row_id = 0
    payments: list[dict] = []
    used_names: set[str] = {name for name, _ in TRAINERS}  # no member shares a trainer's name
    for mid in range(1, args.members + 1):
        while True:
            name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
            if name not in used_names:
                used_names.add(name)
                break
        if mid == 1:
            name = "Aarav Sharma"
            used_names.add(name)
        joined = today - timedelta(days=rng.randint(5, 330))
        trainer_id = rng.choice([None, None, 1, 2, 3]) if mid != 1 else 1
        created = ts(joined, rng.randint(7, 20), rng.choice([0, 15, 30, 45]))

        # Chain memberships from the joining date; a few members lapse at the end.
        start, history = joined, []
        lapse = rng.random() < 0.22
        while start <= today:
            pid = rng.choices([1, 2, 3, 4], weights=[5, 3, 1, 1])[0]
            end = start + timedelta(days=PLANS[pid - 1][1] - 1)
            history.append((pid, start, end))
            if lapse and end > today - timedelta(days=45) and rng.random() < 0.7:
                break
            start = end + timedelta(days=1 if rng.random() < 0.8 else rng.randint(3, 20))
        if mid in (2, 3, 4):  # make sure the dashboard shows members expiring soon
            e = today + timedelta(days=[2, 5, 0][mid - 2])
            history = [(1, e - timedelta(days=29), e)]
            joined = min(joined, e - timedelta(days=29))
            created = ts(joined, 9)
        if mid == 1:  # the demo member login: part-way through an active quarterly plan
            history = [h for h in history if h[2] < today - timedelta(days=60)]
            history.append((2, today - timedelta(days=50), today + timedelta(days=39)))
            if joined > today - timedelta(days=50):
                joined = today - timedelta(days=50)
                created = ts(joined, 9)
        if mid == 64:  # one brand-new member without a plan yet
            history = []
            joined = today - timedelta(days=2)
            created = ts(joined, 18)

        coverage = max((e for _, _, e in history), default=None)
        status = "INACTIVE" if coverage is None else ("ACTIVE" if coverage >= today else "EXPIRED")
        insert("members", {
            "id": mid, "member_code": f"GYM{mid:06d}", "user_id": 4 if mid == 1 else None, "name": name,
            "phone": f"9{rng.randint(100000000, 999999999)}",
            "email": f"{name.split()[0].lower()}.{mid}@example.com" if rng.random() < 0.7 else None,
            "gender": rng.choice(["MALE", "FEMALE"]), "date_of_birth": (today - timedelta(days=rng.randint(18 * 365, 50 * 365))).isoformat(),
            "address": rng.choice(["Indiranagar, Bengaluru", "Koramangala, Bengaluru", "HSR Layout, Bengaluru", None]),
            "emergency_contact": f"9{rng.randint(100000000, 999999999)}" if rng.random() < 0.6 else None,
            "joining_date": joined.isoformat(), "trainer_id": trainer_id, "status": status,
            "qr_token": secrets.token_urlsafe(16), "created_by": 2, "created_at": created, "updated_at": created,
        })
        for pid, s, e in history:
            membership_id += 1
            if e < today:
                ms_status = "EXPIRED"
            elif (e - today).days <= 7 and s <= today:
                ms_status = "EXPIRING"
            else:
                ms_status = "ACTIVE"
            paid_on = s if s <= today else today
            paid_at = ts(paid_on, hour_until_now(rng, paid_on, today, 7, 20), rng.randint(0, 59))
            insert("memberships", {"id": membership_id, "member_id": mid, "plan_id": pid, "start_date": s.isoformat(),
                                   "end_date": e.isoformat(), "amount": PLANS[pid - 1][2], "status": ms_status, "created_by": 2,
                                   "created_at": paid_at, "updated_at": now})
            method = rng.choice(METHODS)
            reference = None
            if method == "UPI":
                reference = f"{rng.randint(10**11, 10**12 - 1)}"
            elif method == "BANK_TRANSFER":
                reference = f"NEFT{rng.randint(10**7, 10**8 - 1)}"
            payments.append({"member_id": mid, "membership_id": membership_id, "plan_id": pid, "amount": PLANS[pid - 1][2],
                             "payment_method": method, "transaction_reference": reference, "status": "PAID",
                             "payment_date": paid_on.isoformat(), "verified_by": 2, "verified_at": paid_at, "notes": None,
                             "created_by": 2, "created_at": paid_at, "updated_at": paid_at})

        # Attendance for the last 45 days while the member had a valid membership.
        regular = rng.random()
        for back in range(45, -1, -1):
            d = today - timedelta(days=back)
            valid = any(s <= d <= e for _, s, e in history)
            if valid and d.weekday() != 6 and rng.random() < 0.25 + regular * 0.55:
                attendance_id += 1
                hour = rng.choice([6, 6, 7, 7, 8] if d == today else [6, 6, 7, 7, 8, 17, 18, 18, 19, 20])
                check_in = ts(d, hour, rng.randint(0, 59))
                insert("attendance", {"id": attendance_id, "member_id": mid, "attendance_date": d.isoformat(), "check_in": check_in,
                                      "check_out": None, "method": "MANUAL" if rng.random() < 0.08 else "QR", "created_at": check_in})

        if trainer_id:
            titles = rng.sample(list(WORKOUTS), k=3)
            for index, title in enumerate(titles):
                plan_row_id += 1
                archived = index == 2  # an older plan the member has moved on from
                stamp = ts(today - timedelta(days=120), 10) if archived else now
                insert("workout_plans", {"id": plan_row_id, "member_id": mid, "trainer_id": trainer_id, "title": title,
                                         "day_label": rng.choice(["Mon / Thu", "Tue / Fri", "Wed / Sat"]), "notes": None,
                                         "status": "ARCHIVED" if archived else "ACTIVE", "created_by": 3, "created_at": stamp,
                                         "updated_at": stamp})
                for pos, (ex, sets, reps, weight, rest) in enumerate(WORKOUTS[title]):
                    insert("workout_exercises", {"workout_plan_id": plan_row_id, "position": pos, "exercise_name": ex, "sets": sets,
                                                 "reps": reps, "weight": weight, "rest_seconds": rest, "notes": None})
            # Plausible monthly check-ins: fixed height, slow fat loss, slight muscle gain.
            height = rng.choice([158, 163, 168, 172, 175, 178, 182])
            weight, fat, waist = rng.uniform(62, 95), rng.uniform(16, 30), rng.uniform(78, 100)
            chest, arm, thigh = rng.uniform(88, 102), rng.uniform(29, 36), rng.uniform(50, 58)
            for month_back in range(5, -1, -1):
                d = today - timedelta(days=month_back * 30 + 2)
                if d < joined:
                    continue
                weight -= rng.uniform(-0.4, 1.4)
                fat -= rng.uniform(0, 0.9)
                waist -= rng.uniform(0, 1.2)
                chest += rng.uniform(-0.3, 0.8)
                arm += rng.uniform(-0.1, 0.4)
                thigh += rng.uniform(-0.3, 0.5)
                insert("body_measurements", {"member_id": mid, "weight": round(weight, 1), "height": height, "body_fat": round(fat, 1),
                                             "chest": round(chest, 1), "waist": round(waist, 1), "arm": round(arm, 1),
                                             "thigh": round(thigh, 1), "recorded_at": ts(d, 18), "created_by": 3})

    # Two UPI payments submitted by members and waiting for verification (no membership yet).
    for mid, pid in ((5, 2), (6, 1)):
        submitted = ts(today, 8, 10 + mid)
        payments.append({"member_id": mid, "membership_id": None, "plan_id": pid, "amount": PLANS[pid - 1][2], "payment_method": "UPI",
                         "transaction_reference": f"4{rng.randint(10**10, 10**11 - 1)}", "status": "PENDING",
                         "payment_date": today.isoformat(), "verified_by": None, "verified_at": None, "notes": None,
                         "created_by": None, "created_at": submitted, "updated_at": submitted})

    # Payment numbers are sequential per year in date order (PAY-2026-000001 ...).
    payments.sort(key=lambda p: (p["payment_date"], p["created_at"], p["member_id"]))
    per_year: dict[str, int] = {}
    refund_target = None
    for index, payment in enumerate(payments, start=1):
        year = payment["payment_date"][:4]
        per_year[year] = per_year.get(year, 0) + 1
        payment_id = index
        row = {"id": payment_id, "payment_number": f"PAY-{year}-{per_year[year]:06d}", **payment}
        if refund_target is None and payment["status"] == "PAID" and payment["payment_date"] <= (today - timedelta(days=40)).isoformat() \
                and payment["payment_date"] >= (today - timedelta(days=70)).isoformat():
            refund_target = row
            row = {**row, "status": "REFUNDED"}
        insert("payments", row)
    if refund_target:
        refund_day = date.fromisoformat(refund_target["payment_date"]) + timedelta(days=3)
        insert("refunds", {"payment_id": refund_target["id"], "amount": 50000, "refund_method": "UPI", "refund_reference": "RFD-20931",
                           "refund_reason": "Joining offer applied after payment", "refund_date": refund_day.isoformat(),
                           "created_by": 1, "created_at": ts(refund_day, 12)})

    for month_back in range(5, -1, -1):
        year, month = today.year, today.month - month_back
        while month <= 0:
            month += 12
            year -= 1
        first = date(year, month, 1)
        for category, amount, desc in EXPENSES:
            d = first + timedelta(days=rng.randint(0, 6))
            if d > today:
                continue
            stamp = ts(d, 8 if d == today else 11)
            insert("expenses", {"category": category, "amount": round(amount * rng.uniform(0.9, 1.1) / 10000) * 10000,
                                "description": desc, "expense_date": d.isoformat(), "created_by": 1, "created_at": stamp,
                                "updated_at": stamp})

    insert("notifications", {"user_id": 4, "type": "WELCOME", "message": "Hi Aarav, welcome to SmartGym Fitness! Your member ID is GYM000001.",
                             "status": "READ", "created_at": now, "read_at": now})
    insert("notifications", {"user_id": 4, "type": "TRAINER_ASSIGNED", "message": "Hi Aarav, Arjun Menon is now your trainer at SmartGym Fitness.",
                             "status": "UNREAD", "created_at": now})
    out.append("")
    out.append("-- Demo logins (development only):")
    for role, login in (("admin", "admin@smartgym.local"), ("staff", "desk@smartgym.local"), ("trainer", "trainer1@smartgym.local"),
                        ("member", "GYM000001")):
        out.append(f"--   {role:<8} {login:<26} {passwords[role]}")
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
