# Description: Extensions that use LNURL usually have a few endpoints in views_lnurl.py.

from http import HTTPStatus

import shortuuid
from fastapi import APIRouter, Query, Request
from lnbits.core.services import create_invoice, pay_invoice
from loguru import logger

from .crud import get_nostriotdashboard

#################################################
########### A very simple LNURLpay ##############
# https://github.com/lnurl/luds/blob/luds/06.md #
#################################################
#################################################

nostriotdashboard_lnurl_router = APIRouter()


@nostriotdashboard_lnurl_router.get(
    "/api/v1/lnurl/pay/{nostriotdashboard_id}",
    status_code=HTTPStatus.OK,
    name="nostriotdashboard.api_lnurl_pay",
)
async def api_lnurl_pay(
    request: Request,
    nostriotdashboard_id: str,
):
    nostriotdashboard = await get_nostriotdashboard(nostriotdashboard_id)
    if not nostriotdashboard:
        return {"status": "ERROR", "reason": "No nostriotdashboard found"}
    return {
        "callback": str(
            request.url_for(
                "nostriotdashboard.api_lnurl_pay_callback",
                nostriotdashboard_id=nostriotdashboard_id,
            )
        ),
        "maxSendable": nostriotdashboard.lnurlpayamount * 1000,
        "minSendable": nostriotdashboard.lnurlpayamount * 1000,
        "metadata": '[["text/plain", "' + nostriotdashboard.name + '"]]',
        "tag": "payRequest",
    }


@nostriotdashboard_lnurl_router.get(
    "/api/v1/lnurl/paycb/{nostriotdashboard_id}",
    status_code=HTTPStatus.OK,
    name="nostriotdashboard.api_lnurl_pay_callback",
)
async def api_lnurl_pay_cb(
    request: Request,
    nostriotdashboard_id: str,
    amount: int = Query(...),
):
    nostriotdashboard = await get_nostriotdashboard(nostriotdashboard_id)
    logger.debug(nostriotdashboard)
    if not nostriotdashboard:
        return {"status": "ERROR", "reason": "No nostriotdashboard found"}

    payment = await create_invoice(
        wallet_id=nostriotdashboard.wallet,
        amount=int(amount / 1000),
        memo=nostriotdashboard.name,
        unhashed_description=f'[["text/plain", "{nostriotdashboard.name}"]]'.encode(),
        extra={
            "tag": "NostriotDashboard",
            "nostriotdashboardId": nostriotdashboard_id,
            "extra": request.query_params.get("amount"),
        },
    )
    return {
        "pr": payment.bolt11,
        "routes": [],
        "successAction": {
            "tag": "message",
            "message": f"Paid {nostriotdashboard.name}",
        },
    }


#################################################
######## A very simple LNURLwithdraw ############
# https://github.com/lnurl/luds/blob/luds/03.md #
#################################################
## withdraw is unlimited, look at withdraw ext ##
## for more advanced withdraw options          ##
#################################################


@nostriotdashboard_lnurl_router.get(
    "/api/v1/lnurl/withdraw/{nostriotdashboard_id}",
    status_code=HTTPStatus.OK,
    name="nostriotdashboard.api_lnurl_withdraw",
)
async def api_lnurl_withdraw(
    request: Request,
    nostriotdashboard_id: str,
):
    nostriotdashboard = await get_nostriotdashboard(nostriotdashboard_id)
    if not nostriotdashboard:
        return {"status": "ERROR", "reason": "No nostriotdashboard found"}
    k1 = shortuuid.uuid(name=nostriotdashboard.id)
    return {
        "tag": "withdrawRequest",
        "callback": str(
            request.url_for(
                "nostriotdashboard.api_lnurl_withdraw_callback",
                nostriotdashboard_id=nostriotdashboard_id,
            )
        ),
        "k1": k1,
        "defaultDescription": nostriotdashboard.name,
        "maxWithdrawable": nostriotdashboard.lnurlwithdrawamount * 1000,
        "minWithdrawable": nostriotdashboard.lnurlwithdrawamount * 1000,
    }


@nostriotdashboard_lnurl_router.get(
    "/api/v1/lnurl/withdrawcb/{nostriotdashboard_id}",
    status_code=HTTPStatus.OK,
    name="nostriotdashboard.api_lnurl_withdraw_callback",
)
async def api_lnurl_withdraw_cb(
    nostriotdashboard_id: str,
    pr: str | None = None,
    k1: str | None = None,
):
    assert k1, "k1 is required"
    assert pr, "pr is required"
    nostriotdashboard = await get_nostriotdashboard(nostriotdashboard_id)
    if not nostriotdashboard:
        return {"status": "ERROR", "reason": "No nostriotdashboard found"}

    k1_check = shortuuid.uuid(name=nostriotdashboard.id)
    if k1_check != k1:
        return {"status": "ERROR", "reason": "Wrong k1 check provided"}

    await pay_invoice(
        wallet_id=nostriotdashboard.wallet,
        payment_request=pr,
        max_sat=int(nostriotdashboard.lnurlwithdrawamount * 1000),
        extra={
            "tag": "NostriotDashboard",
            "nostriotdashboardId": nostriotdashboard_id,
            "lnurlwithdraw": True,
        },
    )
    return {"status": "OK"}
