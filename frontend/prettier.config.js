/** @typedef  {import("prettier").Config} PrettierConfig*/
/** @typedef  {{ tailwindConfig: string }} TailwindConfig*/

/** @type { PrettierConfig | TailwindConfig } */
const config = {
    arrowParens: "always",
    printWidth: 80,
    singleQuote: false,
    jsxSingleQuote: false,
    semi: true,
    trailingComma: "all",
    tabWidth: 4,
    plugins: [
        /**
         * If you're adding more plugins, keep in mind
         * that the Tailwind plugin must come last!
         */
        "prettier-plugin-tailwindcss",
    ],
    tailwindConfig: "./tailwind.config.ts",
};

module.exports = config;
