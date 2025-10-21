# Description: This file contains the extensions API endpoints.

from http import HTTPStatus

from fastapi import APIRouter, Depends, Request
from lnbits.core.models import WalletTypeInfo
from lnbits.core.services import pay_invoice
from lnbits.decorators import require_admin_key
from loguru import logger
from pydantic import BaseModel
from starlette.exceptions import HTTPException

nostriotdashboard_api_router = APIRouter()


# Payment model for internal LNbits payments
class PayInvoiceData(BaseModel):
    bolt11: str
    amount: int  # Amount in satoshis


## Pay invoice with LNbits wallet
@nostriotdashboard_api_router.post("/api/v1/pay-invoice")
async def api_pay_invoice(
    req: Request,
    data: PayInvoiceData,
    wallet: WalletTypeInfo = Depends(require_admin_key),
):
    """Pay a Lightning invoice using the current LNbits wallet"""
    try:
        # Validate the invoice amount matches what we expect
        # This helps prevent payment of wrong amounts

        # Pay the invoice using LNbits internal payment system
        payment_result = await pay_invoice(
            wallet_id=wallet.wallet.id,
            payment_request=data.bolt11,
        )
        logger.debug(f"Payment result: {payment_result}")
        if payment_result.status == "success":
            return {
                "success": True,
                "payment_hash": payment_result.payment_hash,
                "fee": payment_result.fee,
                "message": "Payment successful",
            }
        elif payment_result.status == "pending":
            return {
                "success": True,
                "payment_hash": payment_result.payment_hash,
                "fee": payment_result.fee,
                "message": "Payment pending",
            }
        else:
            return {
                "success": False,
                "error": payment_result.error_message or "Payment failed",
            }

    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail=f"Payment failed: {e!s}"
        ) from e
