"""Read-only MongoDB transaction capability preflight.

Usage (Windows PowerShell, from repository root):
    python -m backend.sync_preflight

Uses MONGO_URL from backend/.env or the process environment. Does not print
credentials, change replica-set settings, create collections, or write data.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


def assess_hello(hello: dict) -> dict:
    """Return a conservative, non-mutating capability assessment."""
    is_mongos = hello.get("msg") == "isdbgrid"
    replica_set = hello.get("setName")
    is_replica_set = bool(replica_set)
    sessions_supported = hello.get("logicalSessionTimeoutMinutes") is not None
    max_wire_version = hello.get("maxWireVersion", 0)
    supported = bool(
        (is_mongos or is_replica_set)
        and sessions_supported
        and max_wire_version >= 7
    )
    return {
        "topology": "sharded" if is_mongos else "replica_set" if is_replica_set else "standalone_or_unknown",
        "replica_set": replica_set,
        "sessions_supported": sessions_supported,
        "max_wire_version": max_wire_version,
        "transaction_prerequisites_present": supported,
    }


async def check_database() -> dict:
    load_dotenv(Path(__file__).resolve().parent / ".env")
    url = os.environ.get("MONGO_URL")
    if not url:
        raise RuntimeError("MONGO_URL is not configured")
    client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=5000)
    try:
        hello = await client.admin.command("hello")
        return assess_hello(hello)
    finally:
        client.close()


def main() -> None:
    result = asyncio.run(check_database())
    print("MongoDB topology:", result["topology"])
    print("Logical sessions supported:", result["sessions_supported"])
    print("Wire version:", result["max_wire_version"])
    print("Transaction prerequisites:", "PASS" if result["transaction_prerequisites_present"] else "NOT MET")
    if not result["transaction_prerequisites_present"]:
        print("Synchronization remains disabled. Do not convert a live server without a tested migration plan.")
    else:
        print("Topology check passed; this does NOT verify transaction commits, sync safety or production readiness.")


if __name__ == "__main__":
    main()
