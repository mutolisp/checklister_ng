import re

def format_scientific_name_markdown(fullname: str) -> str:
    """Format scientific name with italic genus/species and any infraspecific ranks using recursion."""
    remaining = fullname.strip()
    formatted = ""

    # 主學名 (Genus species)
    main_match = re.match(r"^([A-Z][a-z]+ [a-z\-]+)", remaining)
    if not main_match:
        return fullname

    main = main_match.group(1)
    formatted += f"*{main}*"
    remaining = remaining[len(main):].strip()

    # 遞迴處理 subsp./var./f./fo.
    rank_pattern = re.compile(r"^(.*?)\s?(subsp\.|var\.|f\.|fo\.)\s([a-z\-]+)\s?")
    while True:
        match = rank_pattern.match(remaining)
        if not match:
            break
        before_rank = match.group(1).strip()
        rank = match.group(2)
        epithet = match.group(3)

        if before_rank:
            formatted += f" {before_rank}"
        formatted += f" {rank} *{epithet}*"
        remaining = remaining[len(match.group(0)):].strip()

    # 最後作者資訊
    if remaining:
        formatted += f" {remaining}"

    return formatted
