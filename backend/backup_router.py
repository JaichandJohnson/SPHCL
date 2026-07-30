from fastapi import APIRouter, Depends, HTTPException

from backup_service import get_backup_status, run_backup


def create_backup_router(db, get_current_user):
    router = APIRouter(prefix="/api/backup", tags=["Backup"])

    @router.get("/status")
    async def status(user=Depends(get_current_user)):
        return await get_backup_status(db)

    @router.post("/run")
    async def run_now(user=Depends(get_current_user)):
        try:
            return await run_backup(db, trigger="manual")
        except Exception as error:
            raise HTTPException(
                status_code=500,
                detail=f"Backup failed: {error}",
            ) from error

    return router
