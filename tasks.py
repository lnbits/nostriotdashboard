import asyncio

from lnbits.core.models import Payment
from lnbits.core.services import websocket_updater
from lnbits.tasks import register_invoice_listener

from .crud import get_nostriotdashboard, update_nostriotdashboard
from .models import CreateNostriotDashboardData

#######################################
########## RUN YOUR TASKS HERE ########
#######################################

# The usual task is to listen to invoices related to this extension


async def wait_for_paid_invoices():
    invoice_queue = asyncio.Queue()
    register_invoice_listener(invoice_queue, "ext_nostriotdashboard")
    while True:
        payment = await invoice_queue.get()
        await on_invoice_paid(payment)


# Do somethhing when an invoice related top this extension is paid


async def on_invoice_paid(payment: Payment) -> None:
    if payment.extra.get("tag") != "NostriotDashboard":
        return

    nostriotdashboard_id = payment.extra.get("nostriotdashboardId")
    assert nostriotdashboard_id, "nostriotdashboardId not set in invoice"
    nostriotdashboard = await get_nostriotdashboard(nostriotdashboard_id)
    assert nostriotdashboard, "NostriotDashboard does not exist"

    # update something in the db
    if payment.extra.get("lnurlwithdraw"):
        total = nostriotdashboard.total - payment.amount
    else:
        total = nostriotdashboard.total + payment.amount

    nostriotdashboard.total = total
    await update_nostriotdashboard(CreateNostriotDashboardData(**nostriotdashboard.dict()))

    # here we could send some data to a websocket on
    # wss://<your-lnbits>/api/v1/ws/<nostriotdashboard_id> and then listen to it on

    some_payment_data = {
        "name": nostriotdashboard.name,
        "amount": payment.amount,
        "fee": payment.fee,
        "checking_id": payment.checking_id,
    }

    await websocket_updater(nostriotdashboard_id, str(some_payment_data))
