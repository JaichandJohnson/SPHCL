# Auth-Gated App Testing Playbook (Emergent Google Auth)

## Step 1: Create Test User & Session directly in MongoDB
```
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Backend API Test
- `curl -X GET "$BASE/api/auth/me" -H "Authorization: Bearer <TOKEN>"` → returns user
- `curl -X GET "$BASE/api/records" -H "Authorization: Bearer <TOKEN>"` → returns list

## Step 3: Browser test — set cookie session_token then navigate to /dashboard.

## Checklist
- users doc has user_id (custom UUID)
- user_sessions.user_id matches
- All queries use `{"_id": 0}` projection
- /api/auth/me returns user without 401
