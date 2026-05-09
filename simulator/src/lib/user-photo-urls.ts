/**
 * Explicit simulator profile photos.
 *
 * Add legitimate, stable image URLs here when you have the rights to use
 * them. Empty values intentionally fall back to initials in the UI.
 */
export const DUNDER_MIFFLIN_PHOTO_URLS: Record<string, string> = {
  "alan.brand@dundermifflin.example": "",
  "david.wallace@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/en/a/a0/David_Wallace_%28The_Office%29.jpg",
  "ryan.howard@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/BJNovak-byPhilipRomano.jpg/330px-BJNovak-byPhilipRomano.jpg",
  "kendall@dundermifflin.example": "",
  "karen.filippelli@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Rashida_Jones_2017_%28cropped%29.jpg/330px-Rashida_Jones_2017_%28cropped%29.jpg",
  "michael.scott@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Steve_Carell_-_The_40-Year-Old-Virgin.jpg/330px-Steve_Carell_-_The_40-Year-Old-Virgin.jpg",
  "toby.flenderson@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Paul_Lieberstein_at_Los_Angeles_Comic_Con_2023.jpg/330px-Paul_Lieberstein_at_Los_Angeles_Comic_Con_2023.jpg",
  "pam.beesly@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Jenna_Fischer_May08_cropped.jpg/330px-Jenna_Fischer_May08_cropped.jpg",
  "dwight.schrute@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Rainn_Wilson_Photo_Op_GalaxyCon_Richmond_2025_%28cropped%29.jpg/330px-Rainn_Wilson_Photo_Op_GalaxyCon_Richmond_2025_%28cropped%29.jpg",
  "jim.halpert@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/John_Krasinski_2022.jpg/330px-John_Krasinski_2022.jpg",
  "andy.bernard@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Ed_Helms_-_SNAFU.jpg/330px-Ed_Helms_-_SNAFU.jpg",
  "stanley.hudson@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Leslie_David_Baker_Photo_Op_GalaxyCon_Raleigh_2019.jpg/330px-Leslie_David_Baker_Photo_Op_GalaxyCon_Raleigh_2019.jpg",
  "phyllis.vance@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Phyllis_Smith_FOX_2_St._Louis_%28cropped%29.JPG/120px-Phyllis_Smith_FOX_2_St._Louis_%28cropped%29.JPG",
  "angela.martin@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Angela_Kinsey_%282009%29.jpg/330px-Angela_Kinsey_%282009%29.jpg",
  "oscar.martinez@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/2009_CUN_Award_Party_Oscar_Nu%C3%B1ez_058.JPG/330px-2009_CUN_Award_Party_Oscar_Nu%C3%B1ez_058.JPG",
  "kevin.malone@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Brian_Baumgartner_visits_Camp_Pendleton_%282%29_%28cropped%29.jpg/330px-Brian_Baumgartner_visits_Camp_Pendleton_%282%29_%28cropped%29.jpg",
  "creed.bratton@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Creed_Bratton_2019_%2848474439927%29_CROPPED.jpg/330px-Creed_Bratton_2019_%2848474439927%29_CROPPED.jpg",
  "meredith.palmer@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Kate_Flannery_%2830044752398%29.jpg/330px-Kate_Flannery_%2830044752398%29.jpg",
  "kelly.kapoor@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Mindy_Kaling_by_Claire_Leahy_%28cropped%29.jpg/330px-Mindy_Kaling_by_Claire_Leahy_%28cropped%29.jpg",
  "darryl.philbin@dundermifflin.example":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Craig_Robinson_by_Gage_Skidmore.jpg/330px-Craig_Robinson_by_Gage_Skidmore.jpg",
  "lonny.collins@dundermifflin.example": "",
  "madge.madsen@dundermifflin.example": "",
  "hide@dundermifflin.example": "",
  "glenn@dundermifflin.example": "",
  "hank.tate@dundermifflin.example": "",
};

export function getSimulatorUserPhotoUrl(
  email: string,
  explicitUrl?: string | null,
): string | null {
  const explicit = explicitUrl?.trim();
  if (explicit) return explicit;

  const mapped = DUNDER_MIFFLIN_PHOTO_URLS[email.toLowerCase()]?.trim();
  return mapped || null;
}
