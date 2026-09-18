/* The Conts — unit registry.
 * The single source of truth for what the company manages, taken from the client's
 * workbook (Unit资料 sheet). Both The Conts Desktop and The Conts Mobile read this
 * file; neither holds a private copy, so the two products can never disagree about
 * which units exist, who owns them, or how they are performing.
 *
 * Loaded as a plain script from each page's <helmet>; it publishes window.ContsRegistry.
 */
(function () {
  // The single source of truth for what The Conts manages, taken from the client's
  // workbook (Unit\u8d44\u6599 sheet). Properties, Owners, Reservations, the dashboard
  // portfolio and the login strip all derive from this — never a parallel list.
  const PKG = ['A', 'B', 'C', 'D', '\u2014'];
  const MODEL = { LT: 'Long term', PS: 'Profit sharing', '\u2014': 'Not set' };
  const estate = [
    { state: 'Kuala Lumpur', buildings: [
      { name: 'Agile Bukit Bintang', code: 'AGILE', area: 'Imbi, 55100 KL', units: [
        { code: 'AGILE-C1313A', listing: 'Hikari Grove #400M>TRX #500M>Pavilion #105', owner: 'LIANG WOOI KEE', ic: '680606-08-5101', split: '\u2014', model: 'LT', pkg: 'C', grr: '5,000.00', bank: 'PBBB', acct: '4605371109', holder: 'LIANG WOOI KEE & TAN KA CHOO', addr: 'C-13-13A, Lot 1160, Jalan Bukit Bintang, Imbi, 55100 Kuala Lumpur' },
        { code: 'AGILE-C3713A', listing: 'Japandi Oasis #400M>TRX #500M>Pavilion #55', owner: 'WONG SIEW MING', ic: 'PP: C0820268', split: '75/25', model: 'PS', pkg: 'A', grr: '\u2014', bank: 'BOCM', acct: '1000004019932', holder: 'WONG SIEW MING', addr: 'C-37-13A, Lot 1160, Jalan Bukit Bintang, Imbi, 55100 Kuala Lumpur' },
      ] },
      { name: 'Arte Mont Kiara', code: 'ARTE', area: 'Mont Kiara, 50480 KL', units: [
        { code: 'ARTE-MK20916', listing: 'Skyview Suite #5 mins to MITEC #121', owner: 'LIANG WOOI KEE', ic: '680606-08-5101', split: '\u2014', model: 'LT', pkg: 'C', grr: '2,600.00', bank: 'PBBB', acct: '4605371109', holder: 'LIANG WOOI KEE & TAN KA CHOO', addr: 'MK2-09-16, Arte Mont Kiara, No. 15 Jalan Sultan Haji Ahmad Shah, 50480 Kuala Lumpur' },
        { code: 'ARTE-MK20915', listing: 'Daylight Suite #5 mins to MITEC #120', owner: 'CHAN FOONG MEI', ic: '770512-10-5932', split: '80/20', model: 'PS', pkg: 'B', grr: '2,200.00', bank: 'MBBB', acct: '114236289760', holder: 'CHAN FOONG MEI', addr: 'MK2-09-15, Arte Mont Kiara, No. 15 Jalan Sultan Haji Ahmad Shah, 50480 Kuala Lumpur' },
      ] },
      { name: 'Anggun Residences', code: 'ANGGUN', area: 'Chow Kit, 50300 KL', units: [
        { code: 'ANGGUN-2010', listing: 'Urban Family Nest #5 min to KLCC #48', owner: 'LI CHUN XUAN', ic: '\u2014', split: '85/15', model: '\u2014', pkg: '\u2014', grr: '\u2014', bank: 'HLBB', acct: '22200004433', holder: 'LI CHUN XUAN', addr: '20-10, No 8, Anggun Residences JSL, Jalan Medan Tuanku, Chow Kit, 50300 Kuala Lumpur' },
      ] },
      { name: '8th Stellar Sri Petaling', code: '8TH', area: 'Sri Petaling, 57000 KL', units: [
        { code: '8TH-A2907', listing: '8th Stellar A29-07', owner: 'CHAN MUN WEI', ic: '921102-14-6614', split: '\u2014', model: '\u2014', pkg: '\u2014', grr: '\u2014', bank: 'OCBC', acct: '7012852977', holder: 'CHAN MUN WEI', addr: 'A-29-07, 1 Jalan Naga Emas, Bandar Baru Sri Petaling, 57000 Kuala Lumpur' },
      ] },
      { name: 'Skyline KLCC', code: 'SKYLINE', area: 'Jalan Yap Kwan Seng, 50450 KL', units: [
        { code: 'SKYLINE-A1811', listing: 'Skyline A18-11', owner: 'TAN WEI LOON', ic: '850311-14-5521', split: '\u2014', model: 'LT', pkg: 'D', grr: '3,100.00', bank: 'MBBB', acct: '514028771003', holder: 'TAN WEI LOON', addr: 'A-18-11, Skyline KLCC, Jalan Yap Kwan Seng, 50450 Kuala Lumpur' },
        { code: 'SKYLINE-B3111', listing: 'Skyline B31-11', owner: 'NG SOOK YEE', ic: '900214-08-5432', split: '\u2014', model: 'LT', pkg: 'D', grr: '2,200.00', bank: 'PBBB', acct: '4610338821', holder: 'NG SOOK YEE', addr: 'B-31-11, Skyline KLCC, Jalan Yap Kwan Seng, 50450 Kuala Lumpur' },
        { code: 'SKYLINE-A3007', listing: 'Skyline A30-07', owner: 'LIANG WOOI KEE', ic: '680606-08-5101', split: '\u2014', model: 'LT', pkg: 'D', grr: '3,100.00', bank: 'PBBB', acct: '4605371109', holder: 'LIANG WOOI KEE & TAN KA CHOO', addr: 'A-30-07, Skyline KLCC, Jalan Yap Kwan Seng, 50450 Kuala Lumpur' },
      ] },
    ] },
    { state: 'Selangor', buildings: [
      { name: 'Trion Kuchai', code: 'TRION', area: 'Kuchai Lama, 58200', units: [
        { code: 'TRION-B3602', listing: 'Trion B36-02', owner: 'LEE KAH MENG', ic: '880922-10-5117', split: '80/20', model: 'PS', pkg: 'B', grr: '\u2014', bank: 'CIMB', acct: '8004412277', holder: 'LEE KAH MENG', addr: 'B-36-02, Trion @ KL, Jalan Kuchai Lama, 58200 Kuala Lumpur' },
      ] },
      { name: 'M Vertica', code: 'M VERTICA', area: 'Cheras, 56100', units: [
        { code: 'M VERTICA-D1803', listing: 'M Vertica D18-03', owner: 'SITI NORHAYATI', ic: '910405-14-6688', split: '85/15', model: 'PS', pkg: 'A', grr: '\u2014', bank: 'MBBB', acct: '162044887711', holder: 'SITI NORHAYATI', addr: 'D-18-03, M Vertica, Jalan Cheras, 56100 Kuala Lumpur' },
      ] },
    ] },
  ];
  const flatUnits = [];
  estate.forEach((st, si) => st.buildings.forEach((bd, bi) => bd.units.forEach((u, ui) =>
    flatUnits.push({ ...u, state: st.state, building: bd.name, buildingCode: bd.code, area: bd.area, key: si + '.' + bi + '.' + ui }))));

  const perf = {
    'AGILE-C1313A':   { occ: '92.4%', adr: 288, gross: 8640 },
    'AGILE-C3713A':   { occ: '88.1%', adr: 265, gross: 7420 },
    'ARTE-MK20915':   { occ: '90.6%', adr: 246, gross: 6910 },
    'ARTE-MK20916':   { occ: '86.2%', adr: 238, gross: 6380 },
    'ANGGUN-2010':    { occ: '84.7%', adr: 219, gross: 5840 },
    '8TH-A2907':      { occ: '79.3%', adr: 204, gross: 4980 },
    'SKYLINE-A1811':  { occ: '94.1%', adr: 302, gross: 9260 },
    'SKYLINE-A3007':  { occ: '91.5%', adr: 294, gross: 8710 },
    'SKYLINE-B3111':  { occ: '89.8%', adr: 251, gross: 6820 },
    'TRION-B3602':    { occ: '87.2%', adr: 233, gross: 6240 },
    'M VERTICA-D1803':{ occ: '82.5%', adr: 211, gross: 5410 },
  };
  // Operational state per unit, keyed the same way.
  const readiness = {
    'AGILE-C1313A':   ['Occupied', 'info'],
    'AGILE-C3713A':   ['Cleaning', 'info'],
    'ARTE-MK20915':   ['Ready', 'success'],
    'ARTE-MK20916':   ['Occupied', 'info'],
    'ANGGUN-2010':    ['Dirty', 'warning'],
    '8TH-A2907':      ['Dirty', 'warning'],
    'SKYLINE-A1811':  ['Occupied', 'info'],
    'SKYLINE-A3007':  ['Ready', 'success'],
    'SKYLINE-B3111':  ['Cleaning', 'info'],
    'TRION-B3602':    ['Maintenance', 'critical'],
    'M VERTICA-D1803':['Ready', 'success'],
  };
  // The workbook's unit designation lives at the head of the address (C-13-13A, MK2-09-16),
  // so the identifier on screen always agrees with the address under it.
  const shortUnit = (code, addr) => {
    const head = (addr || '').split(',')[0].trim();
    return /^[A-Za-z0-9]+(-[A-Za-z0-9]+)+$/.test(head) || /^\d+-\d+$/.test(head)
      ? '#' + head
      : '#' + code.split('-').slice(1).join('-');
  };

  window.ContsRegistry = {
    estate: estate,
    flatUnits: flatUnits,
    perf: perf,
    readiness: readiness,
    shortUnit: shortUnit,
    MODEL: MODEL,
    PKG: PKG,
    ownerContact: {
      'LIANG WOOI KEE': { email: 'liangwk@example.com', phone: '+60 12-345 6708' },
      'WONG SIEW MING': { email: 'wongsm@example.com', phone: '+60 12-345 6711' },
      'CHAN FOONG MEI': { email: 'chanfm@example.com', phone: '+60 12-345 6712' },
      'LI CHUN XUAN':   { email: 'lcx@example.com', phone: '+60 12-345 6713' },
      'CHAN MUN WEI':   { email: 'chanmw@example.com', phone: '+60 12-345 6714' },
      'TAN WEI LOON':   { email: 'tanwl@example.com', phone: '+60 12-345 6715' },
      'NG SOOK YEE':    { email: 'ngsy@example.com', phone: '+60 12-345 6716' },
      'LEE KAH MENG':   { email: 'leekm@example.com', phone: '+60 12-345 6717' },
      'SITI NORHAYATI': { email: 'siti@example.com', phone: '+60 12-345 6718' },
    },
    BANKNAME: { PBBB: 'Public Bank', BOCM: 'Bank of China', MBBB: 'Maybank', HLBB: 'Hong Leong', OCBC: 'OCBC', CIMB: 'CIMB' },
    // Units grouped by the workbook's 房东/业主 column.
    byOwner: function () {
      var m = new Map();
      flatUnits.forEach(function (u) {
        if (!m.has(u.owner)) m.set(u.owner, []);
        m.get(u.owner).push(u);
      });
      return m;
    },
  };
})();
