/** D1のHTTP SQL分割に合わせる。文字列/識別子とCASEの評価条件は変えない。 */
export function renderD1Wire(sql: string): string {
  const tokens = sql.match(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|\s+|0[xX][A-Fa-f0-9]+|[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?|[A-Za-z_][A-Za-z_0-9]*|->>|->|\|\||<<|>>|<=|>=|<>|!=|==|[^\s]/g,
  );
  const output: string[] = [];
  let caseDepth = 0;
  for (const token of tokens ?? []) {
    if (/^\s+$/.test(token) || token.startsWith("--") || token.startsWith("/*"))
      continue;
    if (token.toUpperCase() === "CASE") {
      output.push("(", token);
      caseDepth += 1;
    } else if (token.toUpperCase() === "END" && caseDepth > 0) {
      output.push(token, ")");
      caseDepth -= 1;
    } else output.push(token);
  }
  if (caseDepth !== 0) throw new Error("d1_wire_case_unbalanced");
  return `${output.join(" ")}\n`;
}
