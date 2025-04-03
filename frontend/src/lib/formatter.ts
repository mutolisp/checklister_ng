// 格式化學名為帶斜體的顯示形式
  // 處理 varietas, subsp., f. 等
  // const pattern = /^(?<main>[A-Z][a-z]+\s[a-z]+\s)(?<auth1>.*?)\s(?<rank>var\.|subsp\.|f\.)\s(?<epithet>[a-z]\s+)(?<auth2>.*)?$/;
  // const pattern = /^(?<main>[A-Z][a-z]+\s[a-z]+)\s(?<auth1>.*?)\s(?<rank>var\.|subsp\.|fo\.|f\.)\s(?<epithet>[a-z\-]+)(?:\s(?<auth2>.*))?$/;
// 格式化學名為帶斜體的顯示形式
// 格式化學名為帶斜體的顯示形式
// export function formatScientificName(fullname: string): string {
//   // 多階學名格式：subsp. + var.（可延伸處理）
//   const complexPattern = /^(?<genus>[A-Z][a-z]+)\s(?<species>[a-z]+)\s(?<auth1>[^\s]+.*?)(\s)?(?<rank1>subsp\.|var\.|fo\.|f\.)\s(?<epithet1>[a-z\-]+)(\s(?<auth2>[^\s]+.*?))?(\s)?(?<rank2>subsp\.|var\.|f\.|fo\.)?\s?(?<epithet2>[a-z\-]+)?(\s(?<auth3>.*))?$/;
// 
//   let match = fullname.match(complexPattern);
//   if (match?.groups?.genus && match.groups.epithet1) {
//     const g = match.groups;
//     const genusSpecies = `<i>${g.genus} ${g.species}</i>`;
//     const ep1 = `${g.rank1} <i>${g.epithet1}</i>`;
//     const ep2 = g.rank2 && g.epithet2 ? ` ${g.rank2} <i>${g.epithet2}</i>` : '';
//     const auths = [g.auth1, g.auth2, g.auth3].filter(Boolean).join(' ');
//     return `${genusSpecies} ${auths} ${ep1}${ep2}`;
//   }
// 
//   // 單一階學名 + 變種
//   const pattern = /^(?<main>[A-Z][a-z]+\s[a-z]+)(?:\s(?<auth1>[^\s]+.*?))?\s(?<rank>var\.|subsp\.|f\.|fo\.)\s(?<epithet>[a-z\-]+)(?:\s(?<auth2>.+))?$/;
//   match = fullname.match(pattern);
//   if (match?.groups) {
//     const { main, auth1 = '', rank, epithet, auth2 = '' } = match.groups;
//     return `<i>${main}</i>${auth1 ? ' ' + auth1 : ''} ${rank} <i>${epithet}</i>${auth2 ? ' ' + auth2 : ''}`;
//   }
// 
//   // 單一階：學名 + 作者
//   const simplePattern = /^(?<main>[A-Z][a-z]+\s[a-z]+)(?<authors>.*)$/;
//   match = fullname.match(simplePattern);
//   if (match?.groups) {
//     const { main, authors = '' } = match.groups;
//     return `<i>${main}</i>${authors}`;
//   }
// 
//   return fullname; // fallback
// }
// 

// 格式化學名為帶斜體的顯示形式
export function formatScientificName(fullname: string): string {
  // 主學名 (Genus species)
  let formatted = "";
  let remaining = fullname.trim();

  // 抓主學名
  const mainMatch = remaining.match(/^([A-Z][a-z]+ [a-z\-]+)/);
  if (!mainMatch) return fullname;

  const main = mainMatch[1];
  formatted += `<i>${main}</i>`;
  remaining = remaining.slice(main.length).trim();

  // 遞迴抓 subsp. / var. / f. / fo. 結構
  const rankPattern = /^(.*?)\s?(subsp\.|var\.|f\.|fo\.)\s([a-z\-]+)\s?/;
  while (true) {
    const match = remaining.match(rankPattern);
    if (!match) break;

    const beforeRank = match[1].trim();
    const rank = match[2];
    const epithet = match[3];

    if (beforeRank) formatted += " " + beforeRank;
    formatted += ` ${rank} <i>${epithet}</i>`;
    remaining = remaining.slice(match[0].length).trim();
  }

  // 剩下的作者資訊直接加上
  if (remaining.length > 0) {
    formatted += " " + remaining;
  }

  return formatted;
}

