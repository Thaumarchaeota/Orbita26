"""Versioned Finance v2 source profiles."""

from . import boc_bank_pdf_text_12, cmb_bank_pdf_text_6, credit_card_pdf_text_6
from . import wallet_csv_13, wallet_xlsx_11

PROFILES = {
    wallet_csv_13.PROFILE_ID: wallet_csv_13,
    wallet_xlsx_11.PROFILE_ID: wallet_xlsx_11,
    credit_card_pdf_text_6.PROFILE_ID: credit_card_pdf_text_6,
    cmb_bank_pdf_text_6.PROFILE_ID: cmb_bank_pdf_text_6,
    boc_bank_pdf_text_12.PROFILE_ID: boc_bank_pdf_text_12,
}

# This is the only accepted caller-visible revision for each registered profile.
PROFILE_REVISIONS = {
    wallet_csv_13.PROFILE_ID: wallet_csv_13.PROFILE_REVISION,
    wallet_xlsx_11.PROFILE_ID: wallet_xlsx_11.PROFILE_REVISION,
    credit_card_pdf_text_6.PROFILE_ID: credit_card_pdf_text_6.PROFILE_REVISION,
    cmb_bank_pdf_text_6.PROFILE_ID: cmb_bank_pdf_text_6.PROFILE_REVISION,
    boc_bank_pdf_text_12.PROFILE_ID: boc_bank_pdf_text_12.PROFILE_REVISION,
}
