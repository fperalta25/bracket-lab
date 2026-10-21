import Alpine from 'alpinejs';

import { preserveDraftLanguage } from './admin/team-draft';

import { publicSimulator } from './public/simulator';

Alpine.data('publicSimulator', publicSimulator);
Alpine.start();
preserveDraftLanguage();
