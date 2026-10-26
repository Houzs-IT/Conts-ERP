import { useCallback, useSyncExternalStore } from 'react';
import { dateIn, monthIn } from './format';

/**
 * The portal in four languages (HR phase 4b, as Hookka's worker portal): English, Bahasa Melayu, Chinese and Burmese.
 * Only the portal's own screens (bottom bar, Clock, Pay, Me, the Jobs switch) are translated; the office side stays
 * English, so this is the one file in src/ allowed other scripts (scripts/checks/english-only.mjs).
 *
 * The language is a choice of the phone, kept in its browser like Hookka's: a new phone starts in English until the
 * person picks again on Me. Every language must fill every string: `PortalStrings` is the English shape, so a missing
 * or misnamed one fails the type-check rather than showing a raw key.
 *
 * Malay, Chinese and Burmese reuse Hookka's worker-portal wording where the strings are the same.
 */

export const PORTAL_LANGS = ['en', 'ms', 'zh', 'my'] as const;
export type PortalLang = (typeof PORTAL_LANGS)[number];
const isLang = (v: unknown): v is PortalLang => PORTAL_LANGS.some(l => l === v);

/** Each language in its own script, so the person can find theirs. */
export const LANG_LABEL: Record<PortalLang, string> = { en: 'English', ms: 'Bahasa Melayu', zh: '中文', my: 'မြန်မာ' };
/** Dates and month names in the language (Burmese has its own, OWN_MONTHS below). */
const LOCALE: Record<PortalLang, string> = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN', my: 'en-MY' };

const KEY = 'conts.portal.lang';
const listeners = new Set<() => void>();

function stored(): PortalLang {
  try {
    const v = localStorage.getItem(KEY);
    return isLang(v) ? v : 'en';
  } catch {
    return 'en'; // storage blocked (private window): the portal reads in English
  }
}

export function setPortalLang(lang: PortalLang): void {
  try { localStorage.setItem(KEY, lang); } catch { /* storage blocked: the choice lasts for this page only */ }
  current = lang;
  for (const fn of listeners) fn();
}

let current: PortalLang | null = null;
const read = (): PortalLang => (current ??= stored());

export function usePortalLang(): PortalLang {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, read, () => 'en');
}

const hmParts = (min: number): [number, string] => [Math.floor(min / 60), String(min % 60).padStart(2, '0')];

const en = {
  nav: { portal: 'Portal', jobs: 'Jobs', clock: 'Clock', pay: 'Pay', me: 'Me', settings: 'Settings', backToday: 'Back to today' },
  common: {
    loading: 'Loading…', back: 'Back', send: 'Send',
    days: (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`,
    hm: (min: number): string => { const [h, m] = hmParts(min); return `${h}h ${m}m`; },
  },
  home: { show: 'Show', cleaning: 'Cleaning', repairs: 'Repairs' },
  clock: {
    title: 'Clock', today: 'Today', notIn: 'Not clocked in',
    inSince: (t: string): string => `In since ${t}`,
    worked: (hm: string): string => `${hm} worked`,
    soFar: (hm: string): string => `${hm} so far`,
    inWithSelfie: 'Clock in with a selfie', outWithSelfie: 'Clock out with a selfie',
    noCameraIn: 'Camera not working? Clock in without a photo', noCameraOut: 'Camera not working? Clock out without a photo',
    done: 'Done for today. Ask the office if a time is wrong.',
    thisMonth: 'This month', noDays: 'No days yet this month.', noClockOut: 'No clock-out',
    clockedIn: (t: string): string => `Clocked in at ${t}.`,
    clockedOut: (t: string): string => `Clocked out at ${t}.`,
    workedToday: (hm: string): string => `${hm} today.`,
    forgotLast: 'You did not clock out last time. The office will check that day.',
    goodDay: 'Have a good day.',
    photoNotSaved: 'Your photo was not saved.', photoNotSavedBody: 'The punch counts. Tell the office if this keeps happening.',
    noLocation: 'No location with this punch.', noLocationBody: 'Turn on location for this site so the office can see where you clocked.',
  },
  me: {
    title: 'Me', language: 'Language',
    leaveYear: (type: string, year: number): string => `${type} ${year}`,
    left: (n: number): string => `${n} left`,
    usedOf: (used: number, allowance: number, pending: number): string => `${used} of ${allowance} used${pending ? ` · ${pending} waiting` : ''}`,
    apply: 'Apply for leave', myRequests: 'My requests', noRequests: 'No leave asked for this year.',
    holidayNotCounted: (days: string): string => `(${days} public holiday not counted)`,
    officeNote: (note: string): string => `Office: ${note}`,
    cancelRequest: 'Cancel request', cancelTitle: 'Cancel this request?',
    cancelBody: (type: string, span: string): string => `${type}, ${span}.`,
    keep: 'Keep it', cancelled: 'Request cancelled.', holidays: 'Public holidays',
    type: 'Type', firstDay: 'First day', lastDay: 'Last day', reason: 'Reason (optional)',
    reasonMedical: 'Bring your MC to the office', reasonOther: 'Family wedding',
    daysNote: (days: string): string => `${days}, weekends included. Public holidays are not taken from your leave.`,
    sent: 'Leave request sent.', sentBody: 'The office will decide. You get a notice when they do.',
  },
  leaveType: { annual: 'Annual leave', medical: 'Medical leave', emergency: 'Emergency leave', unpaid: 'Unpaid leave' },
  leaveStatus: { pending: 'Waiting', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled' },
  pay: {
    title: 'Pay', month: 'Month',
    nothing: (month: string): string => `Nothing for ${month} yet.`,
    estimate: 'Estimate', takeHome: 'Take-home pay', takeHomeSoFar: 'Take-home so far. It changes until the office approves the month.',
    earnings: 'EARNINGS', deductions: 'DEDUCTIONS',
    daysWorked: (n: number): string => `Days worked (${n})`,
    basic: 'Basic salary',
    absent: (days: string): string => `Absent ${days}`,
    lateShort: (h: number): string => `Late / short ${h} h`,
    overtime: (h: number): string => `Overtime ${h} h`,
    sunday: (h: number): string => `Sunday ${h} h`,
    holiday: (h: number): string => `Public holiday ${h} h`,
    leaderAllowance: 'Leader allowance', gross: 'Gross', pcb: 'PCB (tax)', notWorkedOut: 'Not worked out',
    advance: 'Advance taken back', penalty: 'Penalty',
    summary: (worked: number, of: number, leave: number, absent: number): string => `Worked ${worked} of ${of} working days · paid leave ${leave} · absent ${absent}`,
    savePayslip: 'Save payslip as PDF', saveEstimate: 'Save estimate as PDF', pdfEnglish: 'The PDF is in English.',
  },
  payslipStatus: { none: 'Not run', draft: 'Draft', approved: 'Approved', paid: 'Paid' },
};
export type PortalStrings = typeof en;

const ms: PortalStrings = {
  nav: { portal: 'Portal', jobs: 'Kerja', clock: 'Kehadiran', pay: 'Gaji', me: 'Saya', settings: 'Tetapan', backToday: 'Kembali ke hari ini' },
  common: {
    loading: 'Memuatkan…', back: 'Kembali', send: 'Hantar',
    days: n => `${n} hari`,
    hm: min => { const [h, m] = hmParts(min); return `${h}j ${m}m`; },
  },
  home: { show: 'Tunjuk', cleaning: 'Pembersihan', repairs: 'Pembaikan' },
  clock: {
    title: 'Kehadiran', today: 'Hari ini', notIn: 'Belum daftar masuk',
    inSince: t => `Masuk sejak ${t}`,
    worked: hm => `${hm} bekerja`,
    soFar: hm => `${hm} setakat ini`,
    inWithSelfie: 'Daftar masuk dengan swafoto', outWithSelfie: 'Daftar keluar dengan swafoto',
    noCameraIn: 'Kamera tidak berfungsi? Daftar masuk tanpa foto', noCameraOut: 'Kamera tidak berfungsi? Daftar keluar tanpa foto',
    done: 'Selesai untuk hari ini. Tanya pejabat jika ada masa yang salah.',
    thisMonth: 'Bulan ini', noDays: 'Belum ada hari bulan ini.', noClockOut: 'Tiada daftar keluar',
    clockedIn: t => `Daftar masuk pada ${t}.`,
    clockedOut: t => `Daftar keluar pada ${t}.`,
    workedToday: hm => `${hm} hari ini.`,
    forgotLast: 'Anda tidak daftar keluar kali lepas. Pejabat akan menyemak hari itu.',
    goodDay: 'Selamat bekerja.',
    photoNotSaved: 'Foto anda tidak disimpan.', photoNotSavedBody: 'Kehadiran tetap dikira. Beritahu pejabat jika ini berulang.',
    noLocation: 'Tiada lokasi bersama daftar ini.', noLocationBody: 'Hidupkan lokasi untuk laman ini supaya pejabat dapat melihat di mana anda mendaftar.',
  },
  me: {
    title: 'Saya', language: 'Bahasa',
    leaveYear: (type, year) => `${type} ${year}`,
    left: n => `${n} hari lagi`,
    usedOf: (used, allowance, pending) => `${used} daripada ${allowance} digunakan${pending ? ` · ${pending} menunggu` : ''}`,
    apply: 'Mohon cuti', myRequests: 'Permohonan saya', noRequests: 'Tiada permohonan cuti tahun ini.',
    holidayNotCounted: days => `(${days} cuti umum tidak dikira)`,
    officeNote: note => `Pejabat: ${note}`,
    cancelRequest: 'Batal permohonan', cancelTitle: 'Batalkan permohonan ini?',
    cancelBody: (type, span) => `${type}, ${span}.`,
    keep: 'Jangan batal', cancelled: 'Permohonan dibatalkan.', holidays: 'Cuti umum',
    type: 'Jenis', firstDay: 'Hari pertama', lastDay: 'Hari terakhir', reason: 'Sebab (pilihan)',
    reasonMedical: 'Bawa MC anda ke pejabat', reasonOther: 'Majlis perkahwinan keluarga',
    daysNote: days => `${days}, termasuk hujung minggu. Cuti umum tidak ditolak daripada cuti anda.`,
    sent: 'Permohonan cuti dihantar.', sentBody: 'Pejabat akan membuat keputusan. Anda akan menerima notis apabila ia dibuat.',
  },
  leaveType: { annual: 'Cuti tahunan', medical: 'Cuti sakit', emergency: 'Cuti kecemasan', unpaid: 'Cuti tanpa gaji' },
  leaveStatus: { pending: 'Menunggu', approved: 'Diluluskan', rejected: 'Tidak diluluskan', cancelled: 'Dibatalkan' },
  pay: {
    title: 'Gaji', month: 'Bulan',
    nothing: month => `Belum ada untuk ${month}.`,
    estimate: 'Anggaran', takeHome: 'Gaji bersih', takeHomeSoFar: 'Gaji bersih setakat ini. Ia berubah sehingga pejabat meluluskan bulan ini.',
    earnings: 'PENDAPATAN', deductions: 'POTONGAN',
    daysWorked: n => `Hari bekerja (${n})`,
    basic: 'Gaji pokok',
    absent: days => `Tidak hadir ${days}`,
    lateShort: h => `Lewat / kurang jam ${h} j`,
    overtime: h => `Kerja lebih masa ${h} j`,
    sunday: h => `Ahad ${h} j`,
    holiday: h => `Cuti umum ${h} j`,
    leaderAllowance: 'Elaun ketua', gross: 'Kasar', pcb: 'PCB (cukai)', notWorkedOut: 'Belum dikira',
    advance: 'Pendahuluan dipotong balik', penalty: 'Penalti',
    summary: (worked, of, leave, absent) => `Bekerja ${worked} daripada ${of} hari bekerja · cuti bergaji ${leave} · tidak hadir ${absent}`,
    savePayslip: 'Simpan slip gaji sebagai PDF', saveEstimate: 'Simpan anggaran sebagai PDF', pdfEnglish: 'PDF disediakan dalam bahasa Inggeris.',
  },
  payslipStatus: { none: 'Belum dijana', draft: 'Draf', approved: 'Diluluskan', paid: 'Dibayar' },
};

const zh: PortalStrings = {
  nav: { portal: '员工入口', jobs: '工作', clock: '打卡', pay: '薪水', me: '我', settings: '设置', backToday: '返回今天' },
  common: {
    loading: '加载中…', back: '返回', send: '提交',
    days: n => `${n} 天`,
    hm: min => { const [h, m] = hmParts(min); return `${h}小时${m}分`; },
  },
  home: { show: '显示', cleaning: '清洁', repairs: '维修' },
  clock: {
    title: '打卡', today: '今天', notIn: '还没上班打卡',
    inSince: t => `${t} 起已上班`,
    worked: hm => `已工作 ${hm}`,
    soFar: hm => `目前 ${hm}`,
    inWithSelfie: '自拍上班打卡', outWithSelfie: '自拍下班打卡',
    noCameraIn: '相机不能用？不拍照上班打卡', noCameraOut: '相机不能用？不拍照下班打卡',
    done: '今天已完成。时间不对请问办公室。',
    thisMonth: '本月', noDays: '本月还没有记录。', noClockOut: '未下班打卡',
    clockedIn: t => `${t} 上班打卡成功。`,
    clockedOut: t => `${t} 下班打卡成功。`,
    workedToday: hm => `今天 ${hm}。`,
    forgotLast: '你上次没有下班打卡，办公室会核对那一天。',
    goodDay: '祝你今天顺利。',
    photoNotSaved: '你的照片没有保存。', photoNotSavedBody: '打卡有效。如果一直这样，请告诉办公室。',
    noLocation: '这次打卡没有定位。', noLocationBody: '请为本网站开启定位，办公室才能看到你在哪里打卡。',
  },
  me: {
    title: '我的', language: '语言',
    leaveYear: (type, year) => `${year} ${type}`,
    left: n => `剩 ${n} 天`,
    usedOf: (used, allowance, pending) => `已用 ${used} / ${allowance}${pending ? ` · 待批 ${pending}` : ''}`,
    apply: '申请请假', myRequests: '我的申请', noRequests: '今年还没有请假。',
    holidayNotCounted: days => `（${days}公共假期不计）`,
    officeNote: note => `办公室：${note}`,
    cancelRequest: '取消申请', cancelTitle: '取消这个申请？',
    cancelBody: (type, span) => `${type}，${span}。`,
    keep: '不取消', cancelled: '申请已取消。', holidays: '公共假期',
    type: '类型', firstDay: '第一天', lastDay: '最后一天', reason: '原因（可选）',
    reasonMedical: '请把病假单 (MC) 交到办公室', reasonOther: '家人婚礼',
    daysNote: days => `${days}，包括周末。公共假期不扣你的假期。`,
    sent: '请假申请已提交。', sentBody: '办公室会决定，决定后你会收到通知。',
  },
  leaveType: { annual: '年假', medical: '病假', emergency: '紧急事假', unpaid: '无薪假' },
  leaveStatus: { pending: '待批准', approved: '已批准', rejected: '未批准', cancelled: '已取消' },
  pay: {
    title: '薪水', month: '月份',
    nothing: month => `${month} 还没有资料。`,
    estimate: '估算', takeHome: '实发薪水', takeHomeSoFar: '目前的实发薪水。办公室批准本月之前会有变动。',
    earnings: '收入', deductions: '扣除',
    daysWorked: n => `工作天数（${n}）`,
    basic: '底薪',
    absent: days => `缺勤 ${days}`,
    lateShort: h => `迟到 / 工时不足 ${h} 小时`,
    overtime: h => `加班 ${h} 小时`,
    sunday: h => `星期日 ${h} 小时`,
    holiday: h => `公共假期 ${h} 小时`,
    leaderAllowance: '组长津贴', gross: '总额', pcb: 'PCB（所得税）', notWorkedOut: '未计算',
    advance: '扣回预支', penalty: '罚款',
    summary: (worked, of, leave, absent) => `${of} 个工作日中工作 ${worked} 天 · 带薪假 ${leave} · 缺勤 ${absent}`,
    savePayslip: '将工资单保存为 PDF', saveEstimate: '将估算保存为 PDF', pdfEnglish: 'PDF 为英文版。',
  },
  payslipStatus: { none: '未生成', draft: '草稿', approved: '已批准', paid: '已发放' },
};

const my: PortalStrings = {
  nav: { portal: 'ဝန်ထမ်းပေါ်တယ်', jobs: 'အလုပ်များ', clock: 'အချိန်မှတ်', pay: 'လစာ', me: 'ကျွန်ုပ်', settings: 'ဆက်တင်', backToday: 'ယနေ့သို့ ပြန်သွားရန်' },
  common: {
    loading: 'တင်နေသည်…', back: 'ပြန်သွား', send: 'ပို့ရန်',
    days: n => `${n} ရက်`,
    hm: min => { const [h, m] = hmParts(min); return `${h} နာရီ ${m} မိနစ်`; },
  },
  home: { show: 'ပြရန်', cleaning: 'သန့်ရှင်းရေး', repairs: 'ပြုပြင်ရေး' },
  clock: {
    title: 'အချိန်မှတ်', today: 'ယနေ့', notIn: 'အလုပ်ဝင် မမှတ်ရသေးပါ',
    inSince: t => `${t} မှစ၍ အလုပ်ဝင်နေသည်`,
    worked: hm => `${hm} အလုပ်လုပ်ခဲ့သည်`,
    soFar: hm => `ယခုထိ ${hm}`,
    inWithSelfie: 'ဆဲလ်ဖီဖြင့် အလုပ်ဝင်ရန်', outWithSelfie: 'ဆဲလ်ဖီဖြင့် အလုပ်ထွက်ရန်',
    noCameraIn: 'ကင်မရာ အလုပ်မလုပ်ပါသလား။ ဓာတ်ပုံမပါဘဲ အလုပ်ဝင်ရန်', noCameraOut: 'ကင်မရာ အလုပ်မလုပ်ပါသလား။ ဓာတ်ပုံမပါဘဲ အလုပ်ထွက်ရန်',
    done: 'ယနေ့အတွက် ပြီးပါပြီ။ အချိန်မှားနေပါက ရုံးကို မေးပါ။',
    thisMonth: 'ယခုလ', noDays: 'ယခုလ မှတ်တမ်း မရှိသေးပါ။', noClockOut: 'အလုပ်ထွက် မမှတ်ထား',
    clockedIn: t => `${t} တွင် အလုပ်ဝင်ပြီး။`,
    clockedOut: t => `${t} တွင် အလုပ်ထွက်ပြီး။`,
    workedToday: hm => `ယနေ့ ${hm}။`,
    forgotLast: 'ပြီးခဲ့သည့်အကြိမ် အလုပ်ထွက် မမှတ်ခဲ့ပါ။ ထိုနေ့ကို ရုံးက စစ်ဆေးပါမည်။',
    goodDay: 'ကောင်းသောနေ့ ဖြစ်ပါစေ။',
    photoNotSaved: 'သင့်ဓာတ်ပုံ မသိမ်းရပါ။', photoNotSavedBody: 'အချိန်မှတ်ခြင်းမှာ အကျုံးဝင်ပါသည်။ ထပ်ဖြစ်နေပါက ရုံးကို ပြောပါ။',
    noLocation: 'ဤအချိန်မှတ်ခြင်းတွင် တည်နေရာ မပါပါ။', noLocationBody: 'သင် ဘယ်နေရာတွင် အချိန်မှတ်သည်ကို ရုံးက မြင်နိုင်ရန် ဤဆိုက်အတွက် တည်နေရာကို ဖွင့်ပါ။',
  },
  me: {
    title: 'ကျွန်ုပ်', language: 'ဘာသာစကား',
    leaveYear: (type, year) => `${type} ${year}`,
    left: n => `${n} ရက် ကျန်`,
    usedOf: (used, allowance, pending) => `${allowance} ရက်မှ ${used} ရက် သုံးပြီး${pending ? ` · ${pending} ရက် စောင့်ဆိုင်းဆဲ` : ''}`,
    apply: 'ခွင့်လျှောက်ရန်', myRequests: 'ကျွန်ုပ်၏ ခွင့်တောင်းခံမှုများ', noRequests: 'ယခုနှစ် ခွင့်မတောင်းရသေးပါ။',
    holidayNotCounted: days => `(အများပြည်သူ ရုံးပိတ်ရက် ${days} မရေတွက်ပါ)`,
    officeNote: note => `ရုံး: ${note}`,
    cancelRequest: 'တောင်းခံမှု ပယ်ဖျက်ရန်', cancelTitle: 'ဤတောင်းခံမှုကို ပယ်ဖျက်မလား။',
    cancelBody: (type, span) => `${type}၊ ${span}။`,
    keep: 'မပယ်ဖျက်ပါ', cancelled: 'တောင်းခံမှု ပယ်ဖျက်ပြီး။', holidays: 'အများပြည်သူ ရုံးပိတ်ရက်များ',
    type: 'အမျိုးအစား', firstDay: 'ပထမနေ့', lastDay: 'နောက်ဆုံးနေ့', reason: 'အကြောင်းရင်း (မဖြစ်မနေ မဟုတ်)',
    reasonMedical: 'ဆေးလက်မှတ် (MC) ကို ရုံးသို့ ယူလာပါ', reasonOther: 'မိသားစု မင်္ဂလာဆောင်',
    daysNote: days => `${days}၊ စနေ/တနင်္ဂနွေ ပါဝင်သည်။ အများပြည်သူ ရုံးပိတ်ရက်များကို သင့်ခွင့်မှ မနုတ်ပါ။`,
    sent: 'ခွင့်တောင်းခံမှု ပို့ပြီး။', sentBody: 'ရုံးက ဆုံးဖြတ်ပါမည်။ ဆုံးဖြတ်ပြီးလျှင် အသိပေးချက် ရရှိပါမည်။',
  },
  leaveType: { annual: 'နှစ်ပတ်လည်ခွင့်', medical: 'ဆေးခွင့်', emergency: 'အရေးပေါ်ခွင့်', unpaid: 'လစာမဲ့ခွင့်' },
  leaveStatus: { pending: 'စောင့်ဆိုင်းဆဲ', approved: 'ခွင့်ပြုပြီး', rejected: 'ခွင့်မပြုပါ', cancelled: 'ပယ်ဖျက်ပြီး' },
  pay: {
    title: 'လစာ', month: 'လ',
    nothing: month => `${month} အတွက် မရှိသေးပါ။`,
    estimate: 'ခန့်မှန်း', takeHome: 'အသားတင်လစာ', takeHomeSoFar: 'ယခုထိ အသားတင်လစာ။ ရုံးက ဤလကို အတည်မပြုမချင်း ပြောင်းလဲနိုင်သည်။',
    earnings: 'ဝင်ငွေ', deductions: 'နုတ်ယူငွေ',
    daysWorked: n => `အလုပ်လုပ်ရက် (${n})`,
    basic: 'အခြေခံလစာ',
    absent: days => `မလာ ${days}`,
    lateShort: h => `နောက်ကျ / နာရီမပြည့် ${h} နာရီ`,
    overtime: h => `OT ${h} နာရီ`,
    sunday: h => `တနင်္ဂနွေ ${h} နာရီ`,
    holiday: h => `ရုံးပိတ်ရက် ${h} နာရီ`,
    leaderAllowance: 'ခေါင်းဆောင်မှုကြေး', gross: 'စုစုပေါင်း', pcb: 'PCB (အခွန်)', notWorkedOut: 'မတွက်ရသေးပါ',
    advance: 'ကြိုတင်ငွေ ပြန်နုတ်', penalty: 'ဒဏ်ကြေး',
    summary: (worked, of, leave, absent) => `အလုပ်ရက် ${of} ရက်တွင် ${worked} ရက် လုပ်ခဲ့ · လစာပါခွင့် ${leave} · မလာ ${absent}`,
    savePayslip: 'လစာစလစ်ကို PDF အဖြစ် သိမ်းရန်', saveEstimate: 'ခန့်မှန်းချက်ကို PDF အဖြစ် သိမ်းရန်', pdfEnglish: 'PDF ကို အင်္ဂလိပ်ဘာသာဖြင့် ထုတ်ပေးပါသည်။',
  },
  payslipStatus: { none: 'မတွက်ရသေး', draft: 'မူကြမ်း', approved: 'အတည်ပြုပြီး', paid: 'ပေးချေပြီး' },
};

const STRINGS: Record<PortalLang, PortalStrings> = { en, ms, zh, my };

/** The portal's words in the phone's language. */
export function usePortalText(): PortalStrings {
  return STRINGS[usePortalLang()];
}

export interface PortalDates { day: (isoDate: string) => string; month: (period: string) => string }

/** Dates in the phone's language: "26 Oct 2026", "26 Okt 2026", "2026年10月26日"; a pay month as "October 2026". */
export function usePortalDates(): PortalDates {
  const lang = usePortalLang();
  const own = OWN_MONTHS[lang];
  const day = useCallback((isoDate: string): string =>
    (own ? `${Number(isoDate.slice(8, 10))} ${own[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}` : dateIn(LOCALE[lang], isoDate)), [lang, own]);
  const month = useCallback((period: string): string =>
    (own ? `${own[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}` : monthIn(LOCALE[lang], period)), [lang, own]);
  return { day, month };
}

/** Month names a phone's browser may not carry: Chrome's date data has no Burmese, so it falls back to English. */
const OWN_MONTHS: Partial<Record<PortalLang, readonly string[]>> = {
  my: ['ဇန်နဝါရီ', 'ဖေဖော်ဝါရီ', 'မတ်', 'ဧပြီ', 'မေ', 'ဇွန်', 'ဇူလိုင်', 'ဩဂုတ်', 'စက်တင်ဘာ', 'အောက်တိုဘာ', 'နိုဝင်ဘာ', 'ဒီဇင်ဘာ'],
};
