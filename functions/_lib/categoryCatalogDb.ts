import { type Env, all } from './db';
import { catalogOfRows, type CatalogRow, type CategoryCatalog } from './categoryCatalog';

export async function loadCategoryCatalog(env: Env): Promise<CategoryCatalog> {
  return catalogOfRows(await all<CatalogRow>(env,
    'SELECT group_code, group_label, sub_code, sub_label, sub_active FROM product_category_catalog()'));
}
