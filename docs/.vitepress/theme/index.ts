import DefaultTheme from 'vitepress/theme'
import {
  Skull,
  TriangleAlert,
  BugPlay,
  MessageSquareText,
  Users,
  Eye,
  EyeOff,
  X,
  Filter,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
} from 'lucide-vue-next'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Skull', Skull)
    app.component('TriangleAlert', TriangleAlert)
    app.component('BugPlay', BugPlay)
    app.component('MessageSquareText', MessageSquareText)
    app.component('Users', Users)
    app.component('Eye', Eye)
    app.component('EyeOff', EyeOff)
    app.component('XIcon', X)
    app.component('Filter', Filter)
    app.component('Plus', Plus)
    app.component('Pencil', Pencil)
    app.component('Trash2', Trash2)
    app.component('GripVertical', GripVertical)
  },
}
