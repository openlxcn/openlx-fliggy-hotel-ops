import fs from 'node:fs';
import {openStore} from '../src/store.mjs';

// Administrative import of a centrally signed grant. Never signs or sells a pass.
const file=process.argv[2];
if(!file||!process.env.DATA_DIR||!process.env.OPENLX_MEMBERSHIP_PUBLIC_KEY_FILE)throw Error('FILE_DATA_DIR_AND_TRUSTED_PUBLIC_KEY_REQUIRED');
const store=openStore(process.env.DATA_DIR);
try{console.log(JSON.stringify(store.acceptPass(JSON.parse(fs.readFileSync(file))),null,2));}finally{store.db.close();}
