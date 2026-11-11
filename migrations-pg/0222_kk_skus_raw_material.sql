-- REVERSAL: set category, category_group and sub_category back by code prefix: DOR- WORKS/DOOR, GLS- WORKS/ALUMINIUM_GLASS, LED- LIGHTING/LED_STRIP, MSN- WORKS/MASONRY_TILING (MSN-KNK-023 WATERPROOFING), PLC- WORKS/PLASTER_CEILING, PNT- WORKS/PAINTING, PTN- WORKS/PARTITION.
-- K & K's price list is raw material (owner, 5 Nov 2026): every SKU from it moves to Raw material. Its supplier link stays.
update scm.mfg_products
   set category = 'RAW', category_group = 'RAW',
       sub_category = case sub_category
         when 'PLASTER_CEILING' then 'BOARD' when 'PARTITION' then 'BOARD'
         when 'MASONRY_TILING' then 'CEMENT_SAND'
         when 'PAINTING' then 'PAINT_SEALANT' when 'WATERPROOFING' then 'PAINT_SEALANT'
         when 'LED_STRIP' then 'WIRE_FITTING'
         when 'DOOR' then 'HARDWARE'
         else 'OTHER_RAW' end
 where code like '%-KNK-%';
