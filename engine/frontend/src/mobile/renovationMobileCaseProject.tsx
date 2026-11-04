/* The phone's New Service Case in renovation mode (owner, 3 Nov 2026): the case looks up the PROJECT, as on the desktop
   (pages/renovationServiceCase.tsx), not a sales order. The same picker searches project code, name, building / unit,
   customer name and phone, and picking it fills the customer from the project. Houzs mode never renders this. */
import { RenovationItemCategory, RenovationProjectPicker, type RenoCaseCategory, type RenoCaseProject } from "../pages/renovationServiceCase";

export function RenoMobileProjectCard({
  categories,
  project,
  onProject,
  group,
  sub,
  onCategory,
}: {
  categories: RenoCaseCategory[];
  project: RenoCaseProject | null;
  onProject: (p: RenoCaseProject | null) => void;
  group: string;
  sub: string;
  onCategory: (group: string, sub: string) => void;
}) {
  return (
    <div className="so-card">
      <div className="so-hd"><h2 className="so-ti">Project</h2></div>
      <div className="so-bd">
        <div className="fld">
          <span className="fld-l">Project *</span>
          <RenovationProjectPicker value={project} onChange={onProject} />
        </div>
        {categories.length > 0 && (
          <div className="fld">
            <span className="fld-l">If the case is about an item</span>
            <RenovationItemCategory categories={categories} group={group} sub={sub} onChange={onCategory} />
          </div>
        )}
      </div>
    </div>
  );
}

/** While the install's mode is still being read: the card's frame, so the SO form never flashes first. */
export function RenoMobileProjectLoading() {
  return (
    <div className="so-card">
      <div className="so-hd"><h2 className="so-ti">Project</h2></div>
      <div className="so-bd"><div style={{ fontSize: 12, color: "#767b6e" }}>Loading...</div></div>
    </div>
  );
}
