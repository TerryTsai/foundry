import { inputCls } from './TextInput.js'

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} resize-none ${props.className ?? ''}`} />
}
