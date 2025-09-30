# Description: This file contains the extensions API endpoints.

from http import HTTPStatus

from fastapi import APIRouter, Depends, Request
from lnbits.core.crud import get_user
from lnbits.core.models import WalletTypeInfo
from lnbits.core.services import create_invoice
from lnbits.decorators import require_admin_key, require_invoice_key
from starlette.exceptions import HTTPException

from .crud import (
    create_nostriotdashboard,
    delete_nostriotdashboard,
    get_nostriotdashboard,
    get_nostriotdashboards,
    update_nostriotdashboard,
)
from .helpers import lnurler
from .models import CreateNostriotDashboardData, CreatePayment, NostriotDashboard

nostriotdashboard_api_router = APIRouter()

# Note: we add the lnurl params to returns so the links
# are generated in the NostriotDashboard model in models.py

## Get all the records belonging to the user


@nostriotdashboard_api_router.get("/api/v1/myex")
async def api_nostriotdashboards(
    req: Request,  # Withoutthe lnurl stuff this wouldnt be needed
    wallet: WalletTypeInfo = Depends(require_invoice_key),
) -> list[NostriotDashboard]:
    wallet_ids = [wallet.wallet.id]
    user = await get_user(wallet.wallet.user)
    wallet_ids = user.wallet_ids if user else []
    nostriotdashboards = await get_nostriotdashboards(wallet_ids)

    # Populate lnurlpay and lnurlwithdraw for each instance.
    # Without the lnurl stuff this wouldnt be needed.
    for myex in nostriotdashboards:
        myex.lnurlpay = lnurler(myex.id, "nostriotdashboard.api_lnurl_pay", req)
        myex.lnurlwithdraw = lnurler(myex.id, "nostriotdashboard.api_lnurl_withdraw", req)

    return nostriotdashboards


## Get a single record


@nostriotdashboard_api_router.get(
    "/api/v1/myex/{nostriotdashboard_id}",
    dependencies=[Depends(require_invoice_key)],
)
async def api_nostriotdashboard(nostriotdashboard_id: str, req: Request) -> NostriotDashboard:
    myex = await get_nostriotdashboard(nostriotdashboard_id)
    if not myex:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="NostriotDashboard does not exist."
        )
    # Populate lnurlpay and lnurlwithdraw.
    # Without the lnurl stuff this wouldnt be needed.
    myex.lnurlpay = lnurler(myex.id, "nostriotdashboard.api_lnurl_pay", req)
    myex.lnurlwithdraw = lnurler(myex.id, "nostriotdashboard.api_lnurl_withdraw", req)

    return myex


## Create a new record


@nostriotdashboard_api_router.post("/api/v1/myex", status_code=HTTPStatus.CREATED)
async def api_nostriotdashboard_create(
    req: Request,  # Withoutthe lnurl stuff this wouldnt be needed
    data: CreateNostriotDashboardData,
    wallet: WalletTypeInfo = Depends(require_admin_key),
) -> NostriotDashboard:
    myex = await create_nostriotdashboard(data)

    # Populate lnurlpay and lnurlwithdraw.
    # Withoutthe lnurl stuff this wouldnt be needed.
    myex.lnurlpay = lnurler(myex.id, "nostriotdashboard.api_lnurl_pay", req)
    myex.lnurlwithdraw = lnurler(myex.id, "nostriotdashboard.api_lnurl_withdraw", req)

    return myex


## update a record


@nostriotdashboard_api_router.put("/api/v1/myex/{nostriotdashboard_id}")
async def api_nostriotdashboard_update(
    req: Request,  # Withoutthe lnurl stuff this wouldnt be needed
    data: CreateNostriotDashboardData,
    nostriotdashboard_id: str,
    wallet: WalletTypeInfo = Depends(require_admin_key),
) -> NostriotDashboard:
    myex = await get_nostriotdashboard(nostriotdashboard_id)
    if not myex:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="NostriotDashboard does not exist."
        )

    if wallet.wallet.id != myex.wallet:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN, detail="Not your NostriotDashboard."
        )

    for key, value in data.dict().items():
        setattr(myex, key, value)

    myex = await update_nostriotdashboard(data)

    # Populate lnurlpay and lnurlwithdraw.
    # Without the lnurl stuff this wouldnt be needed.
    myex.lnurlpay = lnurler(myex.id, "nostriotdashboard.api_lnurl_pay", req)
    myex.lnurlwithdraw = lnurler(myex.id, "nostriotdashboard.api_lnurl_withdraw", req)

    return myex


## Delete a record


@nostriotdashboard_api_router.delete("/api/v1/myex/{nostriotdashboard_id}")
async def api_nostriotdashboard_delete(
    nostriotdashboard_id: str, wallet: WalletTypeInfo = Depends(require_admin_key)
):
    myex = await get_nostriotdashboard(nostriotdashboard_id)

    if not myex:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="NostriotDashboard does not exist."
        )

    if myex.wallet != wallet.wallet.id:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN, detail="Not your NostriotDashboard."
        )

    await delete_nostriotdashboard(nostriotdashboard_id)
    return


# ANY OTHER ENDPOINTS YOU NEED

## This endpoint creates a payment


@nostriotdashboard_api_router.post("/api/v1/myex/payment", status_code=HTTPStatus.CREATED)
async def api_nostriotdashboard_create_invoice(data: CreatePayment) -> dict:
    nostriotdashboard = await get_nostriotdashboard(data.nostriotdashboard_id)

    if not nostriotdashboard:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="NostriotDashboard does not exist."
        )

    # we create a payment and add some tags,
    # so tasks.py can grab the payment once its paid

    payment = await create_invoice(
        wallet_id=nostriotdashboard.wallet,
        amount=data.amount,
        memo=(
            f"{data.memo} to {nostriotdashboard.name}" if data.memo else f"{nostriotdashboard.name}"
        ),
        extra={
            "tag": "nostriotdashboard",
            "amount": data.amount,
        },
    )

    return {"payment_hash": payment.payment_hash, "payment_request": payment.bolt11}
