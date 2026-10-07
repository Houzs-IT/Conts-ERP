-- The supply chain engine's company identity.
-- 1. The single company keeps the internal code HOUZS. The engine's code branches on that code in about
--    50 places (document rules, numbering, bundled logo), and the owner wants the supply chain to behave
--    exactly as Houzs's does; under any other code it would take the "other company" paths instead.
--    It is an internal key only: every name people see comes from the branding row below.
-- 2. The company details printed on documents and shown on the sign-in page, taken from what is already
--    entered in the rental app's Settings so the two agree. A blank field would fall back to Houzs's own
--    address and phone (compiled into the engine), so nothing is left blank.
-- REVERSAL: UPDATE public.companies SET code = 'CONTS', name = 'The Conts' WHERE code = 'HOUZS';
--           DELETE FROM public.app_settings WHERE key = 'branding';
UPDATE public.companies SET code = 'HOUZS' WHERE code = 'CONTS';

INSERT INTO public.app_settings (key, value)
SELECT 'branding', jsonb_build_object(
  'companyName',    COALESCE(NULLIF(s.legal_name, ''), 'The Conts Sdn Bhd'),
  'registrationNo', COALESCE(NULLIF(s.company_number, ''), 'To be confirmed'),
  'address',        COALESCE(NULLIF(s.address, ''), 'Address to be confirmed'),
  'postcode',       COALESCE(substring(s.address from '\m\d{5}\M'), ''),
  'phone',          COALESCE(NULLIF(s.phone, ''), 'To be confirmed'),
  'email',          COALESCE(NULLIF(s.email, ''), 'help@theconts.com'),
  'website',        'theconts.com',
  'logoR2Key', '', 'printLogoR2Key', '', 'csPhone', '', 'csEmail', '',
  'customerPaymentDetails', '', 'debtorPaymentDetails', '', 'debtorInvoiceTerms', ''
)::text
FROM (
  SELECT max(trim(both '"' from value::text)) FILTER (WHERE key = 'org.legal_name')     AS legal_name,
         max(trim(both '"' from value::text)) FILTER (WHERE key = 'org.company_number') AS company_number,
         max(trim(both '"' from value::text)) FILTER (WHERE key = 'org.address')        AS address,
         max(trim(both '"' from value::text)) FILTER (WHERE key = 'org.support_phone')  AS phone,
         max(trim(both '"' from value::text)) FILTER (WHERE key = 'company.supportEmail') AS email
  FROM pos.settings
) s
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
