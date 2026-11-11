import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const config = [
  ...nextVitals,
  ...nextTs,
  {
    // Rules introduced with the React Compiler lint set. The existing pages fetch data in
    // effects, which these flag; they are tracked as warnings and cleaned up gradually
    // instead of blocking CI on a style migration.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'scripts/**', 'test/**'] },
]

export default config
