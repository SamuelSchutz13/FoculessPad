import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import PadView from '@/views/PadView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/:name(.*)+', component: PadView, props: (route) => ({ name: [route.params.name].flat().join('/') }) },
  ],
})
