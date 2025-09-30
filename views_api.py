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


