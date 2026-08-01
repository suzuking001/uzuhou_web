import { App } from './app/App';
import './styles/main.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application root was not found.');

const app = new App(root);
void app.mount();
