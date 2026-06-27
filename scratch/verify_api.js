// Using global fetch


async function runVerification() {
  console.log('--- STARTING BACKEND API VERIFICATION ---');
  
  // 1. Login as Admin
  console.log('Logging in as admin...');
  const loginRes = await fetch('http://localhost:3000/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'admin123',
      mode: 'admin'
    })
  });
  
  if (!loginRes.ok) {
    console.error('Login failed:', await loginRes.text());
    process.exit(1);
  }
  
  const cookie = loginRes.headers.get('set-cookie');
  console.log('Login successful. Cookie acquired.');
  
  // 2. Create User with EMPTY/NULL tipe_karyawan
  const uniqueId = Date.now().toString().slice(-6);
  const testUser = {
    username: `testuser_${uniqueId}`,
    nama_lengkap: `Test User ${uniqueId}`,
    nik: `NIK_${uniqueId}`,
    posisi: 'Picker',
    tipe_karyawan: '' // Blank tipe_karyawan
  };
  
  console.log('Creating operational user with blank tipe_karyawan...', testUser);
  const createRes = await fetch('http://localhost:3000/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie
    },
    body: JSON.stringify(testUser)
  });
  
  const createData = await createRes.json();
  if (!createData.success) {
    console.error('User creation failed:', createData);
    process.exit(1);
  }
  
  console.log('User created successfully:', createData.data);
  if (createData.data.tipe_karyawan === null || createData.data.tipe_karyawan === '') {
    console.log('✅ SUCCESS: tipe_karyawan is indeed saved as null/empty!');
  } else {
    console.error('❌ FAIL: tipe_karyawan was saved as:', createData.data.tipe_karyawan);
    process.exit(1);
  }
  
  const createdUserId = createData.data.id;
  
  // 3. Update User to "PHL"
  console.log('Updating user to PHL...');
  const updateRes1 = await fetch(`http://localhost:3000/api/users/${createdUserId}`, {
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
    console.error('Update to PHL failed:', updateData1);
    process.exit(1);
  }
  console.log('Update to PHL successful:', updateData1.data);
  if (updateData1.data.tipe_karyawan === 'PHL') {
    console.log('✅ SUCCESS: tipe_karyawan updated to PHL!');
  } else {
    console.error('❌ FAIL: tipe_karyawan is:', updateData1.data.tipe_karyawan);
    process.exit(1);
  }
  
  // 4. Update User back to empty/null
  console.log('Updating user back to blank...');
  const updateRes2 = await fetch(`http://localhost:3000/api/users/${createdUserId}`, {
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
    console.error('Update back to blank failed:', updateData2);
    process.exit(1);
  }
  console.log('Update back to blank successful:', updateData2.data);
  if (updateData2.data.tipe_karyawan === null || updateData2.data.tipe_karyawan === '') {
    console.log('✅ SUCCESS: tipe_karyawan updated back to null/empty!');
  } else {
    console.error('❌ FAIL: tipe_karyawan is:', updateData2.data.tipe_karyawan);
    process.exit(1);
  }
  
  // 5. Clean up (delete user)
  console.log('Deleting test user...');
  const deleteRes = await fetch(`http://localhost:3000/api/users/${createdUserId}`, {
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
  
  console.log('--- ALL BACKEND VERIFICATIONS PASSED SUCCESSFULLY ---');
}

runVerification().catch(err => {
  console.error('Verification encountered an uncaught error:', err);
  process.exit(1);
});
