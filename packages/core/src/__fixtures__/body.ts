// Layout copied from real bodies (label dn-kafr-eldawar); site/cell names are fictional.
export function body(o: {
  kind?: "NEW" | "CLEARENCE";
  name?: string;
  start?: string;
  site?: string;
  cell?: string | null;
  device?: string;
  consec?: string;
}) {
  const cell = o.cell === undefined ? "A_XX-TEST_3_24313_S" : o.cell;
  return [
    `\t\t\t############${o.kind ?? "NEW"} ALARM###########`,
    "",
    "ALARM NAME: ",
    `\t\t${o.name ?? "WCDMA CELL OUT OF USE"}`,
    "ALARM_START_TIME: ",
    `\t\t${o.start ?? "11-OCT-2026 21:02:49"}`,
    "NE_name: ",
    "\t\tRNC66",
    "Alarm_Number",
    "\t\t7771",
    "MR_of_Controled_NE: ",
    "\t\tNO",
    "MR_of_Site:",
    "\t\tSYS_DELTA_NORTH",
    "ALARM_SITE:",
    `\t\t${o.site ?? "U_S_XX-TEST_3830DE"}`,
    ...(cell ? ["cell name :", `\t\t${cell}`] : []),
    "ALARM_Device:",
    `\t\t${o.device ?? (cell ? "cell" : "MRBTS")}`,
    "CONSEC_NBR: ",
    `\t\t ${o.consec ?? "2291814"}`,
    "THANKS FOR USING THIS TOOL",
    "REGARGDS",
    "D.S",
  ].join("\r\n");
}
