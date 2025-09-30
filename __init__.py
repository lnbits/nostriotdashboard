import asyncio

from fastapi import APIRouter
from lnbits.tasks import create_permanent_unique_task
from loguru import logger

from .crud import db
from .tasks import wait_for_paid_invoices
from .views import nostriotdashboard_generic_router
from .views_api import nostriotdashboard_api_router
from .views_lnurl import nostriotdashboard_lnurl_router

logger.debug(
    "This logged message is from nostriotdashboard/__init__.py, you can debug in your "
    "extension using 'import logger from loguru' and 'logger.debug(<thing-to-log>)'."
)


nostriotdashboard_ext: APIRouter = APIRouter(prefix="/nostriotdashboard", tags=["NostriotDashboard"])
nostriotdashboard_ext.include_router(nostriotdashboard_generic_router)
nostriotdashboard_ext.include_router(nostriotdashboard_api_router)
nostriotdashboard_ext.include_router(nostriotdashboard_lnurl_router)

nostriotdashboard_static_files = [
    {
        "path": "/nostriotdashboard/static",
        "name": "nostriotdashboard_static",
    }
]

scheduled_tasks: list[asyncio.Task] = []


def nostriotdashboard_stop():
    for task in scheduled_tasks:
        try:
            task.cancel()
        except Exception as ex:
            logger.warning(ex)


def nostriotdashboard_start():
    task = create_permanent_unique_task("ext_nostriotdashboard", wait_for_paid_invoices)
    scheduled_tasks.append(task)


__all__ = [
    "db",
    "nostriotdashboard_ext",
    "nostriotdashboard_start",
    "nostriotdashboard_static_files",
    "nostriotdashboard_stop",
]
