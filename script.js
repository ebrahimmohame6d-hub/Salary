// ==================== CONFIG ====================
const EMPLOYEES = {
  'ibrahim': { password: '5060', displayName: 'Ibrahim', isAdmin: true,  salary: 6484, workDays: 26, hoursPerDay: 8 },
};

const ANNUAL_LEAVE_TOTAL = 15;

const PROPS = PropertiesService.getScriptProperties();

function getEmpDayRate(emp) {
  if (!emp) return 0;
  return emp.dayRate !== undefined ? emp.dayRate : parseFloat((emp.salary / emp.workDays).toFixed(2));
}

function getEmpHourRate(emp) {
  if (!emp) return 0;
  return parseFloat((getEmpDayRate(emp) / emp.hoursPerDay).toFixed(2));
}

function doGet(e) {
  var output = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('HR System')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  return output;
}

function login(username, password) {
  const emp = EMPLOYEES[username.toLowerCase().trim()];
  if (!emp || emp.password !== password)
    return { success: false, msg: 'اسم المستخدم أو الباسورد غلط' };
  // حفظ بيانات الدخول تلقائياً عشان تتعبى لوحدها في المرة الجاية
  try {
    PropertiesService.getUserProperties().setProperties({
      'saved_username': username.toLowerCase().trim(),
      'saved_password': password
    });
  } catch(e) {}
  return {
    success: true,
    username:    username.toLowerCase().trim(),
    displayName: emp.displayName,
    isAdmin:     emp.isAdmin,
    salary:      emp.salary,
    dayRate:     getEmpDayRate(emp),
    hourRate:    getEmpHourRate(emp)
  };
}

function getSavedLogin() {
  try {
    var up = PropertiesService.getUserProperties();
    return {
      username: up.getProperty('saved_username') || '',
      password: up.getProperty('saved_password') || ''
    };
  } catch(e) {
    return { username: '', password: '' };
  }
}

function getEmployeeList() {
  return Object.entries(EMPLOYEES).map(([k, v]) => ({
    username:    k,
    displayName: v.displayName,
    salary:      v.salary,
    dayRate:     getEmpDayRate(v),
    hourRate:    getEmpHourRate(v)
  }));
}

function getPeriodDays(year, month) {
  var startMonth = month - 1;
  var startYear  = year;
  if (startMonth < 1) { startMonth = 12; startYear--; }

  var days    = [];
  var DAYS_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

  var daysInPrevMonth = new Date(startYear, startMonth, 0).getDate();
  for (var d = 26; d <= daysInPrevMonth; d++) {
    var dow = new Date(startYear, startMonth - 1, d).getDay();
    days.push({ day: d, month: startMonth, year: startYear,
                dayName: DAYS_AR[dow], key: startYear+'_'+startMonth+'_'+d });
  }
  for (var d = 1; d <= 25; d++) {
    var dow = new Date(year, month - 1, d).getDay();
    days.push({ day: d, month: month, year: year,
                dayName: DAYS_AR[dow], key: year+'_'+month+'_'+d });
  }
  return days;
}

function getAttendance(username, year, month) {
  var periodDays = getPeriodDays(year, month);
  var result     = [];
  var allProps   = PROPS.getProperties();

  periodDays.forEach(function(pd) {
    var key   = 'att_' + username + '_' + pd.key;
    var raw   = allProps[key];
    var saved = raw ? JSON.parse(raw) : {};
    result.push({
      day:        pd.day,
      month:      pd.month,
      year:       pd.year,
      dayName:    pd.dayName,
      key:        pd.key,
      status:     saved.status     || '',
      otHours:    saved.otHours    || 0,
      otRate:     saved.otRate     || 1.5,
      otType:     saved.otType     || 'ot',
      compTarget: saved.compTarget || '',
      dedDay1:    saved.dedDay1    || 0,
      dedDay2:    saved.dedDay2    || 0,
      dedDay3:    saved.dedDay3    || 0,
      dedHalfInd: saved.dedHalfInd || 0
    });
  });

  return result;
}

function saveAttendanceDay(username, year, month, dayData) {
  var key = 'att_' + username + '_' + dayData.key;
  PROPS.setProperty(key, JSON.stringify(dayData));
  try {
    var cache = CacheService.getScriptCache();
    cache.remove(key);
    cache.remove('att_all_' + username);
  } catch(e) {}
  return 'ok';
}

function getAnnualLeaveSummary(username, year) {
  var totalUsed = 0;
  var countedKeys = {};
  for (var m = 1; m <= 12; m++) {
    var att = getAttendance(username, year, m);
    att.forEach(function(d) {
      if (d.status === 'Annual' && !countedKeys[d.key]) {
        countedKeys[d.key] = true;
        totalUsed++;
      }
    });
  }
  var lastPeriod = getAttendance(username, year + 1, 1);
  lastPeriod.forEach(function(d) {
    if (d.status === 'Annual' && !countedKeys[d.key]) {
      countedKeys[d.key] = true;
      totalUsed++;
    }
  });

  return {
    used:      totalUsed,
    total:     ANNUAL_LEAVE_TOTAL,
    remaining: Math.max(0, ANNUAL_LEAVE_TOTAL - totalUsed)
  };
}

function calcSalary(username, year, month) {
  var emp = EMPLOYEES[username];
  if (!emp) return null;

  var dayRate  = getEmpDayRate(emp);
  var hourRate = getEmpHourRate(emp);

  var att = getAttendance(username, year, month);

  var absence = 0, annual = 0, dayOff = 0, compensation = 0;
  var fridayDouble = 0, otHoursTotal = 0, otAmount = 0;
  var otEffHoursTotal = 0;
  var compHoursTotal = 0;
  var ded3 = 0, dedHalf = 0, ded1 = 0, ded2 = 0;
  var indDed1Total = 0, indDed2Total = 0, indDed3Total = 0, indDedHalfTotal = 0;
  var otBreakdown = { x1_5: [], x2: [] };

  att.forEach(function(d) {
    var s  = d.status || '';
    var ot = d.otType || 'ot';

    if      (s === 'Absence')              absence++;
    else if (s === 'Annual')               annual++;
    else if (s === 'Day Off')              dayOff++;
    else if (s === 'Compensation')         compensation++;
    else if (s === 'Friday + Double Paid') fridayDouble++;
    else if (s === 'Deduction 3 day')      ded3++;
    else if (s === 'Deduction half day')   dedHalf++;
    else if (s === 'Deduction 1 day')      ded1++;
    else if (s === 'Deduction 2 day')      ded2++;

    if (d.dedDay1    && d.dedDay1    > 0) indDed1Total    += parseFloat(d.dedDay1);
    if (d.dedDay2    && d.dedDay2    > 0) indDed2Total    += parseFloat(d.dedDay2);
    if (d.dedDay3    && d.dedDay3    > 0) indDed3Total    += parseFloat(d.dedDay3);
    if (d.dedHalfInd && d.dedHalfInd > 0) indDedHalfTotal += parseFloat(d.dedHalfInd);

    if (d.otHours && d.otHours > 0) {
      if (ot === 'comp') {
        compHoursTotal += d.otHours;
      } else {
        var rate     = parseFloat(d.otRate) || 1.5;
        var effHours = parseFloat((d.otHours * rate).toFixed(2));
        var amt      = parseFloat((d.otHours * hourRate * rate).toFixed(2));
        otHoursTotal     += d.otHours;
        otEffHoursTotal  += effHours;
        otAmount         += amt;
        if (rate <= 1.5) {
          otBreakdown.x1_5.push({ hours: d.otHours, effHours: effHours, amount: amt });
        } else {
          otBreakdown.x2.push({ hours: d.otHours, effHours: effHours, amount: amt });
        }
      }
    }
  });

  // كل الخصومات (من الحالة Status + من الصندوق المستقل) بتتحول لساعات وتتخصم من توتال الأوفر بس
  // مفيش أي خصم فلوس مباشر من المرتب — الخصم كله بيحصل بالساعات قبل تحويل الأوفر لفلوس
  var statusDeductions = 0; // غير مستخدمة في الحساب — للتوافق فقط
  var indDeductions    = 0; // غير مستخدمة في الحساب — للتوافق فقط
  var deductions       = 0; // مفيش خصم فلوس مباشر من صافي المرتب

  //  دابل = ساعات اليوم الرسمي × ٢ (بريت دابل) — مثل أي يوم أوفر بريت ×٢
  var fridayHoursPerDay = emp.hoursPerDay || 8;
  var fridayEffHours    = parseFloat((fridayDouble * fridayHoursPerDay * 2).toFixed(2));
  var fridayAmount      = fridayDouble * dayRate * 2;

  // إجمالي الساعات الفعلية لكل الأوفر (شامل الجمعة) — نفس الرقم في الـ badge فوق وفي "توتال الأوفر"
  var otEffHoursWithFriday = parseFloat((otEffHoursTotal + fridayEffHours).toFixed(2));
  var otEffDaysWithFriday  = emp.hoursPerDay ? parseFloat((otEffHoursWithFriday / emp.hoursPerDay).toFixed(2)) : 0;

  // ساعات خصومات الحالة (Status: Deduction 1/2/3/نص يوم) بالساعات الفعلية
  var statusDedHours = parseFloat((
    (ded1 * 1 + ded2 * 2 + ded3 * 3 + dedHalf * 0.5) * (emp.hoursPerDay || 8)
  ).toFixed(2));

  // ساعات الخصومات المستقلة (الصندوق تحت: dedDay1/2/3 = عدد الأيام بالضبط، dedHalfInd = عدد مرات نص اليوم)
  var indDedHours = parseFloat((
    (indDed1Total * 1 + indDed2Total * 1 + indDed3Total * 1 + indDedHalfTotal * 0.5) * (emp.hoursPerDay || 8)
  ).toFixed(2));

  // إجمالي ساعات الخصم (حالة + مستقل) — هي اللي بتتخصم من توتال الأوفر
  var statusDedHoursTotal = parseFloat((statusDedHours + indDedHours).toFixed(2));
  var statusDedDays       = parseFloat((statusDedHoursTotal / (emp.hoursPerDay || 8)).toFixed(2));
  // إعادة تسمية للتوافق مع الواجهة (statusDedHours يستخدم في الواجهة كإجمالي الخصم بالساعات)
  statusDedHours = statusDedHoursTotal;

  // الأوفر الصافي بالساعات = توتال الأوفر - إجمالي ساعات الخصم
  var otEffHoursNet  = parseFloat(Math.max(0, otEffHoursWithFriday - statusDedHoursTotal).toFixed(2));
  var otEffDaysNet   = parseFloat((otEffHoursNet / (emp.hoursPerDay || 8)).toFixed(2));

  // مبلغ الأوفر الصافي = الساعات الصافية × معدل الساعة
  // (نسبة الساعات الصافية من التوتال × otAmount+fridayAmount)
  var otTotalAmount  = otAmount + fridayAmount;
  var otNetAmount    = otEffHoursWithFriday > 0
    ? parseFloat((otEffHoursNet / otEffHoursWithFriday * otTotalAmount).toFixed(2))
    : 0;

  // الإضافات على المرتب = الأوفر الصافي بس (بعد خصم كل الخصومات من الساعات)
  var totalAdditions = otNetAmount;
  // صافي المرتب = الأساسي + الإضافات (الأوفر الصافي) — مفيش أي خصم فلوس تاني
  var netSalary      = emp.salary + totalAdditions - deductions;

  return {
    basicSalary:      emp.salary,
    dayRate:          parseFloat(dayRate.toFixed(2)),
    hourRate:         parseFloat(hourRate.toFixed(2)),
    absence, annual, dayOff, compensation,
    fridayDouble,
    fridayAmount:     parseFloat(fridayAmount.toFixed(2)),
    fridayEffHours:   fridayEffHours,
    otHoursTotal:     parseFloat(otHoursTotal.toFixed(1)),
    otEffHoursTotal:  parseFloat(otEffHoursTotal.toFixed(2)),
    otEffHoursWithFriday,
    otEffDaysWithFriday,
    otAmount:         parseFloat(otAmount.toFixed(2)),
    compHoursTotal:   parseFloat(compHoursTotal.toFixed(1)),
    otBreakdown,
    ded3, dedHalf, ded1, ded2,
    indDed1Total:     parseFloat(indDed1Total.toFixed(1)),
    indDed2Total:     parseFloat(indDed2Total.toFixed(1)),
    indDed3Total:     parseFloat(indDed3Total.toFixed(1)),
    indDedHalfTotal:  parseFloat(indDedHalfTotal.toFixed(1)),
    indDeductions:    parseFloat(indDeductions.toFixed(2)),
    statusDeductions: parseFloat(statusDeductions.toFixed(2)), // للعرض فقط (دايمًا 0 الآن، الخصم الفعلي بالساعات)
    deductions:       parseFloat(deductions.toFixed(2)),
    totalAdditions:   parseFloat(totalAdditions.toFixed(2)),
    netSalary:        parseFloat(netSalary.toFixed(2)),
    statusDedHours,
    statusDedDays,
    otEffHoursNet,
    otEffDaysNet,
    otNetAmount:      parseFloat(otNetAmount.toFixed(2)),
    otTotalAmount:    parseFloat(otTotalAmount.toFixed(2))
  };
}

function calcSalaryWithLeave(username, year, month) {
  var salary     = calcSalary(username, year, month);
  var annualLeave = getAnnualLeaveSummary(username, year);
  return { salary: salary, annualLeave: annualLeave };
}

function getAllSalaries(year, month) {
  return Object.entries(EMPLOYEES).map(function([k, v]) {
    var sal = calcSalary(k, year, month);
    return Object.assign({ username: k, name: v.displayName }, sal);
  });
}
