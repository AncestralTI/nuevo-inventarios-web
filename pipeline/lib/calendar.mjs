// pipeline/lib/calendar.mjs
// Réplica de la tabla calculada `Calendar` del modelo (Calendar.tmdl):
//   WeekYear = IF(AND(Date>DATE(2021,12,28), Date<DATE(2022,1,1)),
//                 YEAR(Date)+1 & RIGHT("0"&WEEKNUM,2),
//                 YEAR(Date) & RIGHT("0"&WEEKNUM,2))
//   WEEKNUM  = WEEKNUM(Date, 2)   -- Excel WEEKNUM tipo 2: semanas empiezan lunes,
//                                    la semana que contiene el 1-ene es la semana 1.
//   WeekDay  = WEEKDAY(Date, 2)   -- 1=lunes .. 7=domingo
//
// Todas las fechas se manejan como Date UTC "sin hora" (medianoche UTC) para evitar
// desfases de zona horaria al hacer aritmética de días.

import { addDays, fmtDate } from "./sheets.mjs";

/** WEEKDAY(date, 2) de Excel: 1=lunes .. 7=domingo. */
export function weekdayIso(date) {
  const jsDay = date.getUTCDay(); // 0=domingo .. 6=sábado
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * WEEKNUM(date, 2) de Excel: semanas empiezan en lunes; la semana que contiene
 * el 1 de enero de ese año es la semana 1 (NO es ISO 8601, que exige que la
 * semana 1 contenga el primer jueves del año).
 */
export function excelWeekNum2(date) {
  const year = date.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Weekday = weekdayIso(jan1); // 1..7 (lunes..domingo)
  // Inicio de la semana 1 = el lunes de la semana que contiene el 1-ene.
  const week1Start = addDays(jan1, -(jan1Weekday - 1));
  const diffDays = Math.round((date.getTime() - week1Start.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

/** Columna WeekDay Name = FORMAT(Date, "ddd") — abreviatura de día en inglés (locale por defecto de Power BI). */
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function weekdayName(date) {
  return WEEKDAY_NAMES[date.getUTCDay()];
}

/** Réplica exacta de la columna calculada WeekYear del TMDL, incluyendo el parche puntual 2021/2022. */
export function weekYear(date) {
  const wn = excelWeekNum2(date);
  const y = date.getUTCFullYear();
  const patchStart = new Date(Date.UTC(2021, 11, 28)); // DATE(2021,12,28)
  const patchEnd = new Date(Date.UTC(2022, 0, 1)); // DATE(2022,1,1)
  const isPatchRange = date.getTime() > patchStart.getTime() && date.getTime() < patchEnd.getTime();
  const yearPart = isPatchRange ? y + 1 : y;
  return `${yearPart}${String(wn).padStart(2, "0")}`;
}

/** Devuelve el lunes de la semana ISO (WeekDay=1) a la que pertenece `date`. */
export function mondayOf(date) {
  const wd = weekdayIso(date);
  return addDays(date, -(wd - 1));
}

/** Dado un weekYear (p.ej. "202637"), y una fecha de referencia cercana para desambiguar el año,
 *  devuelve el rango [lunes, domingo] de esa semana, recorriendo hacia atrás/adelante desde hoy. */
export function weekYearToRange(targetWeekYear, anchorDate) {
  // Búsqueda simple: partimos del lunes de la semana de `anchorDate` y nos movemos
  // semana a semana (hacia atrás y adelante) hasta encontrar el weekYear buscado.
  let monday = mondayOf(anchorDate);
  for (let i = 0; i < 400; i++) {
    if (weekYear(monday) === targetWeekYear) {
      return { start: monday, end: addDays(monday, 6) };
    }
    monday = addDays(monday, -7);
  }
  monday = mondayOf(anchorDate);
  for (let i = 0; i < 400; i++) {
    if (weekYear(monday) === targetWeekYear) {
      return { start: monday, end: addDays(monday, 6) };
    }
    monday = addDays(monday, 7);
  }
  return null;
}

/** Genera metadatos de calendario (weekYear, weekday, etc.) para una fecha dada. */
export function calendarRow(date) {
  return {
    date,
    dateStr: fmtDate(date),
    weekYear: weekYear(date),
    weekDay: weekdayIso(date),
    weekDayName: weekdayName(date),
  };
}
