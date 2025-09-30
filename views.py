# Description: Add your page endpoints here.

from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from lnbits.core.models import User
from lnbits.decorators import check_user_exists
from lnbits.helpers import template_renderer
from lnbits.settings import settings

from .crud import get_nostriotdashboard
from .helpers import lnurler

nostriotdashboard_generic_router = APIRouter()


def nostriotdashboard_renderer():
    return template_renderer(["nostriotdashboard/templates"])


#######################################
##### ADD YOUR PAGE ENDPOINTS HERE ####
#######################################


# Backend admin page


@nostriotdashboard_generic_router.get("/", response_class=HTMLResponse)
async def index(req: Request, user: User = Depends(check_user_exists)):
    return nostriotdashboard_renderer().TemplateResponse(
        "nostriotdashboard/index.html", {"request": req, "user": user.json()}
    )


# Frontend shareable page


@nostriotdashboard_generic_router.get("/{nostriotdashboard_id}")
async def nostriotdashboard(req: Request, nostriotdashboard_id):
    myex = await get_nostriotdashboard(nostriotdashboard_id)
    if not myex:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="NostriotDashboard does not exist."
        )
    return nostriotdashboard_renderer().TemplateResponse(
        "nostriotdashboard/nostriotdashboard.html",
        {
            "request": req,
            "nostriotdashboard_id": nostriotdashboard_id,
            "lnurlpay": lnurler(myex.id, "nostriotdashboard.api_lnurl_pay", req),
            "web_manifest": f"/nostriotdashboard/manifest/{nostriotdashboard_id}.webmanifest",
        },
    )


# Manifest for public page, customise or remove manifest completely


@nostriotdashboard_generic_router.get("/manifest/{nostriotdashboard_id}.webmanifest")
async def manifest(nostriotdashboard_id: str):
    nostriotdashboard = await get_nostriotdashboard(nostriotdashboard_id)
    if not nostriotdashboard:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="NostriotDashboard does not exist."
        )

    return {
        "short_name": settings.lnbits_site_title,
        "name": nostriotdashboard.name + " - " + settings.lnbits_site_title,
        "icons": [
            {
                "src": (
                    settings.lnbits_custom_logo
                    if settings.lnbits_custom_logo
                    else "https://cdn.jsdelivr.net/gh/lnbits/lnbits@0.3.0/docs/logos/lnbits.png"
                ),
                "type": "image/png",
                "sizes": "900x900",
            }
        ],
        "start_url": "/nostriotdashboard/" + nostriotdashboard_id,
        "background_color": "#1F2234",
        "description": "Minimal extension to build on",
        "display": "standalone",
        "scope": "/nostriotdashboard/" + nostriotdashboard_id,
        "theme_color": "#1F2234",
        "shortcuts": [
            {
                "name": nostriotdashboard.name + " - " + settings.lnbits_site_title,
                "short_name": nostriotdashboard.name,
                "description": nostriotdashboard.name + " - " + settings.lnbits_site_title,
                "url": "/nostriotdashboard/" + nostriotdashboard_id,
            }
        ],
    }
