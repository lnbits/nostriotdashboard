# Description: This file contains the CRUD operations for talking to the database.


from lnbits.db import Database
from lnbits.helpers import urlsafe_short_hash

from .models import CreateNostriotDashboardData, NostriotDashboard

db = Database("ext_nostriotdashboard")


async def create_nostriotdashboard(data: CreateNostriotDashboardData) -> NostriotDashboard:
    data.id = urlsafe_short_hash()
    await db.insert("nostriotdashboard.maintable", data)
    return NostriotDashboard(**data.dict())


async def get_nostriotdashboard(nostriotdashboard_id: str) -> NostriotDashboard | None:
    return await db.fetchone(
        "SELECT * FROM nostriotdashboard.maintable WHERE id = :id",
        {"id": nostriotdashboard_id},
        NostriotDashboard,
    )


async def get_nostriotdashboards(wallet_ids: str | list[str]) -> list[NostriotDashboard]:
    if isinstance(wallet_ids, str):
        wallet_ids = [wallet_ids]
    q = ",".join([f"'{w}'" for w in wallet_ids])
    return await db.fetchall(
        f"SELECT * FROM nostriotdashboard.maintable WHERE wallet IN ({q}) ORDER BY id",
        model=NostriotDashboard,
    )


async def update_nostriotdashboard(data: CreateNostriotDashboardData) -> NostriotDashboard:
    await db.update("nostriotdashboard.maintable", data)
    return NostriotDashboard(**data.dict())


async def delete_nostriotdashboard(nostriotdashboard_id: str) -> None:
    await db.execute(
        "DELETE FROM nostriotdashboard.maintable WHERE id = :id", {"id": nostriotdashboard_id}
    )
