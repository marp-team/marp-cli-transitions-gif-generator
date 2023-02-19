import path from 'node:path'

interface TemplateOptions {
  transition: string
}

const asset = (aseetName: string) =>
  path.resolve(__dirname, '../assets', aseetName)

export const template = ({ transition }: TemplateOptions) => {
  const [transitionName] = transition.split(' ')

  return `
---
transition: ${transition}
theme: uncover
style: |
  h1 {
    line-height: 2;
  }
  img {
    display: inline-block;
    height: 1em;
    margin: 0.5em 0;
    box-sizing: border-box;
    width: 1.5em;
    vertical-align: top;
  }
_backgroundImage: linear-gradient(-45deg, #ddd, #fff)
---

# ![](${asset('marp.svg')}) <!--fit--> ${transitionName}

---

<!--
backgroundColor: #0288d1;
class: invert
-->

# <!--fit--> ${transitionName} ![](${asset('marp-outline.svg')})
`.trim()
}
