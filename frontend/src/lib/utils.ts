import yaml from "js-yaml";

export function debounce<T extends (...args: any[]) => void>(func: T, wait = 300) {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function downloadYAML(data: any, filename = "checklist.yml") {
  const yamlText = yaml.dump({ ["checklister-ng"]: data });
  const blob = new Blob([yamlText], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
