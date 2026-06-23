'use client'

export default function Footer() {
  return (
    <footer className="border-t border-green-200 px-6 py-12">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
        <div>
          <span className="text-green-700 font-bold text-base">boss</span>
          <span className="text-green-950 font-bold text-base">-cli</span>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <a href="/blog" className="text-green-800 hover:text-green-950 transition-colors">博客</a>
          <a href="https://github.com/joohw/boss-cli" target="_blank" rel="noopener noreferrer" className="text-green-800 hover:text-green-950 transition-colors">GitHub</a>
          <a href="https://www.npmjs.com/package/@joohw/boss-cli" target="_blank" rel="noopener noreferrer" className="text-green-800 hover:text-green-950 transition-colors">NPM</a>
          <a href="https://github.com/joohw/boss-cli/issues" target="_blank" rel="noopener noreferrer" className="text-green-800 hover:text-green-950 transition-colors">Issues</a>
          <a href="https://github.com/joohw/boss-cli/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="text-green-800 hover:text-green-950 transition-colors">许可证</a>
        </div>
      </div>
    </footer>
  )
}
