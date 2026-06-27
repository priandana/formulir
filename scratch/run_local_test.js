const { spawn } = require('node:child_process');
// Using global fetch

async function runLocalTest() {
  console.log('--- STARTING LOCAL API VERIFICATION (LOWDB MODE) ---');
  
  // 1. Spawn server on port 3001 in LowDB mode
  console.log('Starting local server on port 3001...');
  const serverEnv = {
    ...process.env,
    PORT: '3001',
    SUPABASE_URL: '',
    SUPABASE_KEY: ''
  };
  
  const server = spawn('node', ['server.js'], { env: serverEnv });
  
  server.stdout.on('data', (data) => {
    // console.log(`[SERVER]: ${data}`);
  });
  
  server.stderr.on('data', (data) => {
    console.error(`[SERVER ERR]: ${data}`);
  });
  
  // Wait 3 seconds for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log('Local server started.');
  
  try {
    // 2. Login as Admin (LowDB admin has password 'admin123' or from database.json)
    console.log('Logging in as admin on port 3001...');
    const loginRes = await fetch('http://localhost:3001/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123', // matching the database.json hash
        mode: 'admin'
      })
    });
    
    if (!loginRes.ok) {
      throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
    }
    
    const cookie = loginRes.headers.get('set-cookie');
    console.log('Login successful. Cookie acquired.');
    
    // 3. Create User with EMPTY tipe_karyawan
    const uniqueId = Date.now().toString().slice(-6);
    const testUser = {
      username: `testuser_${uniqueId}`,
      nama_lengkap: `Test User ${uniqueId}`,
      nik: `NIK_${uniqueId}`,
      posisi: 'Picker',
      tipe_karyawan: '' // Blank
    };
    
    console.log('Creating operational user with blank tipe_karyawan...', testUser);
    const createRes = await fetch('http://localhost:3001/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify(testUser)
    });
    
    const createData = await createRes.json();
    if (!createData.success) {
      throw new Error(`User creation failed: ${JSON.stringify(createData)}`);
    }
    
    console.log('User created successfully:', createData.data);
    if (createData.data.tipe_karyawan === null) {
      console.log('✅ SUCCESS: tipe_karyawan is saved as null!');
    } else {
      throw new Error(`FAIL: tipe_karyawan was saved as: ${createData.data.tipe_karyawan}`);
    }
    
    const createdUserId = createData.data.id;
    
    // 4. Update User to "PHL"
    console.log('Updating user to PHL...');
    const updateRes1 = await fetch(`http://localhost:3001/api/users/${createdUserId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify({
        ...testUser,
        tipe_karyawan: 'PHL'
      })
    });
    
    const updateData1 = await updateRes1.json();
    if (!updateData1.success) {
      throw new Error(`Update to PHL failed: ${JSON.stringify(updateData1)}`);
    }
    console.log('Update to PHL successful:', updateData1.data);
    if (updateData1.data.tipe_karyawan === 'PHL') {
      console.log('✅ SUCCESS: tipe_karyawan updated to PHL!');
    } else {
      throw new Error(`FAIL: tipe_karyawan is: ${updateData1.data.tipe_karyawan}`);
    }
    
    // 5. Update User back to empty/null
    console.log('Updating user back to blank...');
    const updateRes2 = await fetch(`http://localhost:3001/api/users/${createdUserId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify({
        ...testUser,
        tipe_karyawan: ''
      })
    });
    
    const updateData2 = await updateRes2.json();
    if (!updateData2.success) {
      throw new Error(`Update back to blank failed: ${JSON.stringify(updateData2)}`);
    }
    console.log('Update back to blank successful:', updateData2.data);
    if (updateData2.data.tipe_karyawan === null) {
      console.log('✅ SUCCESS: tipe_karyawan updated back to null!');
    } else {
      throw new Error(`FAIL: tipe_karyawan is: ${updateData2.data.tipe_karyawan}`);
    }
    
    // 6. Clean up (delete user)
    console.log('Deleting test user...');
    const deleteRes = await fetch(`http://localhost:3001/api/users/${createdUserId}`, {
      method: 'DELETE',
      headers: {
        'Cookie': cookie
      }
    });
    const deleteData = await deleteRes.json();
    if (deleteData.success) {
      console.log('✅ Clean up successful. Test user deleted.');
    } else {
      console.warn('⚠️ Clean up warning: Failed to delete test user.');
    }
    
    console.log('--- ALL LOCAL VERIFICATIONS PASSED SUCCESSFULLY ---');
  } finally {
    console.log('Stopping local server...');
    server.kill();
  }
}

runLocalTest().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
