# Description: Pydantic data models dictate what is passed between frontend and backend.


from pydantic import BaseModel


class CreateNostriotDashboardData(BaseModel):
    id: str | None = ""
    name: str
    lnurlpayamount: int
    lnurlwithdrawamount: int
    wallet: str
    total: int = 0


class NostriotDashboard(BaseModel):
    id: str
    name: str
    lnurlpayamount: int
    lnurlwithdrawamount: int
    wallet: str
    total: int
    lnurlpay: str | None = ""
    lnurlwithdraw: str | None = ""


class CreatePayment(BaseModel):
    nostriotdashboard_id: str
    amount: int
    memo: str
