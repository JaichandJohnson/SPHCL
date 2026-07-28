import asyncio
import os

from dotenv import load_dotenv

from backup_service import connect_database, run_backup


async def main():
    load_dotenv()

    enabled = (
        os.environ.get("ENABLE_GOOGLE_DRIVE_BACKUP", "false")
        .strip()
        .lower()
        == "true"
    )
    if not enabled:
        print("Automatic Google Drive backup is disabled.")
        return

    client, db = await connect_database()
    try:
        result = await run_backup(db, trigger="scheduled")
        print(
            "Backup completed:",
            result.get("filename"),
            result.get("drive_url"),
        )
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
