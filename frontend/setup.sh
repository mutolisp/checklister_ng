#!/bin/bash

echo "🚀 使用 create-svelte 初始化 SvelteKit 專案..."
cd ..
npx sv create frontend

cd frontend
npm install

echo "🎨 安裝 TailwindCSS..."
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init tailwind.config.cjs -p

cat <<EOT > tailwind.config.cjs
module.exports = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
      extend: {},
    },
  plugins: [require('@tailwindcss/forms')],
}
EOT

mkdir -p src/stores src/lib
touch src/app.css
echo '@tailwind base;\n@tailwind components;\n@tailwind utilities;' > src/app.css

echo "✅ 完成！請記得在 +layout.svelte 中引入 app.css"

