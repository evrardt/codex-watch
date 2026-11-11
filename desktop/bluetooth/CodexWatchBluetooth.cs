// Windows Bluetooth Classic gateway. The only destination is the local Codex Watch HTTP server.
// Every RFCOMM connection requires OS Bluetooth authentication and encryption; the
// existing per-watch bearer token is still checked by the HTTP server.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

internal static class CodexWatchBluetooth {
    const int AF_BTH=32, RFCOMM=3, Auth=unchecked((int)0x80000001), Encrypt=2;
    const int MaxFrame=16384, MaxStreams=16;
    static readonly Guid ServiceId=new Guid("3f868ec6-4c41-449d-a997-d502f0344d5c");
    [StructLayout(LayoutKind.Sequential,Pack=1)] struct Bth { public ushort family;public ulong address;public Guid service;public uint port; }
    [StructLayout(LayoutKind.Sequential)] struct SockAddress { public IntPtr address;public int length; }
    [StructLayout(LayoutKind.Sequential)] struct CsAddr { public SockAddress local,remote;public int type,protocol; }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Query { public int size;[MarshalAs(UnmanagedType.LPWStr)]public string name;public IntPtr service;public IntPtr version;[MarshalAs(UnmanagedType.LPWStr)]public string comment;public int nameSpace;public IntPtr provider;[MarshalAs(UnmanagedType.LPWStr)]public string context;public int protocols;public IntPtr afProtocols;[MarshalAs(UnmanagedType.LPWStr)]public string queryString;public int number;public IntPtr addresses;public int flags;public IntPtr blob; }
    [DllImport("ws2_32.dll")] static extern int WSAStartup(ushort version,byte[] data);
    [DllImport("ws2_32.dll")] static extern IntPtr socket(int af,int type,int protocol);
    [DllImport("ws2_32.dll")] static extern int setsockopt(IntPtr socket,int level,int name,ref uint value,int length);
    [DllImport("ws2_32.dll")] static extern int bind(IntPtr socket,ref Bth address,int length);
    [DllImport("ws2_32.dll")] static extern int getsockname(IntPtr socket,ref Bth address,ref int length);
    [DllImport("ws2_32.dll")] static extern int listen(IntPtr socket,int backlog);
    [DllImport("ws2_32.dll")] static extern IntPtr accept(IntPtr socket,IntPtr address,IntPtr length);
    [DllImport("ws2_32.dll")] static extern int recv(IntPtr socket,byte[] buffer,int length,int flags);
    [DllImport("ws2_32.dll")] static extern int send(IntPtr socket,byte[] buffer,int length,int flags);
    [DllImport("ws2_32.dll",CharSet=CharSet.Unicode)] static extern int WSASetService(ref Query query,int operation,int flags);
    [DllImport("ws2_32.dll")] static extern int closesocket(IntPtr socket);
    [DllImport("ws2_32.dll")] static extern int WSAGetLastError();
    static void Check(int result,string label) { if(result!=0) throw new IOException(label+" ("+WSAGetLastError()+")"); }
    static int ReadInt(byte[] b,int i) { return (b[i]<<24)|(b[i+1]<<16)|(b[i+2]<<8)|b[i+3]; }
    static void PutInt(byte[] b,int i,int value) { b[i]=(byte)(value>>24);b[i+1]=(byte)(value>>16);b[i+2]=(byte)(value>>8);b[i+3]=(byte)value; }
    static bool ReadExact(IntPtr socket,byte[] result) { int n=0;while(n<result.Length){byte[] temp=new byte[result.Length-n];int r=recv(socket,temp,temp.Length,0);if(r<=0)return false;Buffer.BlockCopy(temp,0,result,n,r);n+=r;}return true; }
    internal sealed class Link {
        readonly IntPtr socket;readonly int port;readonly object gate=new object();readonly object lockStreams=new object();
        readonly Dictionary<int,TcpClient> streams=new Dictionary<int,TcpClient>();bool closed;
        public Link(IntPtr socket,int port) { this.socket=socket;this.port=port; }
        void Frame(byte type,int id,byte[] data,int count) {
            byte[] frame=new byte[9+count];frame[0]=type;PutInt(frame,1,id);PutInt(frame,5,count);if(count>0)Buffer.BlockCopy(data,0,frame,9,count);
            lock(gate) { if(closed)return;int offset=0;while(offset<frame.Length){byte[] part=new byte[frame.Length-offset];Buffer.BlockCopy(frame,offset,part,0,part.Length);int n=send(socket,part,part.Length,0);if(n<=0){closed=true;return;}offset+=n;} }
        }
        void CloseStream(int id,bool tell) { TcpClient client=null;lock(lockStreams){if(streams.TryGetValue(id,out client))streams.Remove(id);}if(client!=null)try{client.Close();}catch{}if(tell)Frame(3,id,null,0); }
        void Open(int id) {
            TcpClient client=new TcpClient();
            bool rejected;lock(lockStreams){rejected=closed||streams.ContainsKey(id)||streams.Count>=MaxStreams;if(!rejected)streams.Add(id,client);}if(rejected){client.Close();Frame(3,id,null,0);return;}
            Task.Run(()=>{try{client.Connect(IPAddress.Loopback,port);NetworkStream stream=client.GetStream();Frame(4,id,null,0);byte[] buffer=new byte[MaxFrame];int n;while((n=stream.Read(buffer,0,buffer.Length))>0)Frame(2,id,buffer,n);}catch{}finally{CloseStream(id,true);}});
        }
        public void Run() { try { byte[] head=new byte[9];while(ReadExact(socket,head)) { byte op=head[0];int id=ReadInt(head,1),len=ReadInt(head,5);if(id<=0||len<0||len>MaxFrame)break;byte[] bytes=new byte[len];if(len>0&&!ReadExact(socket,bytes))break;if(op==1&&len==0)Open(id);else if(op==3&&len==0)CloseStream(id,false);else if(op==2){TcpClient client;lock(lockStreams)streams.TryGetValue(id,out client);if(client!=null)try{client.GetStream().Write(bytes,0,bytes.Length);}catch{CloseStream(id,true);}}else break; } } finally { lock(gate)closed=true;lock(lockStreams){foreach(var client in streams.Values)try{client.Close();}catch{}streams.Clear();}closesocket(socket); } }
    }
    static int Main(string[] args) {
        int port,parent;if(args.Length!=2||!int.TryParse(args[0],out port)||port<1||port>65535||!int.TryParse(args[1],out parent)||parent<1)return 2;
        try {var owner=System.Diagnostics.Process.GetProcessById(parent);Task.Run(()=>{try{owner.WaitForExit();}catch{}Environment.Exit(0);});}catch{return 2;}
        IntPtr server=IntPtr.Zero,aPtr=IntPtr.Zero,csPtr=IntPtr.Zero,idPtr=IntPtr.Zero;Query q=new Query();bool registered=false;
        try { Check(WSAStartup(0x202,new byte[512]),"startup");server=socket(AF_BTH,1,RFCOMM);if(server==new IntPtr(-1))throw new IOException("socket");uint yes=1;Check(setsockopt(server,RFCOMM,Auth,ref yes,4),"authentication");Check(setsockopt(server,RFCOMM,Encrypt,ref yes,4),"encryption");Bth a=new Bth{family=AF_BTH,port=uint.MaxValue};int size=Marshal.SizeOf(typeof(Bth));Check(bind(server,ref a,size),"bind");Check(getsockname(server,ref a,ref size),"address");Check(listen(server,2),"listen");aPtr=Marshal.AllocHGlobal(size);Marshal.StructureToPtr(a,aPtr,false);CsAddr cs=new CsAddr{local=new SockAddress{address=aPtr,length=size},type=1,protocol=RFCOMM};csPtr=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(CsAddr)));Marshal.StructureToPtr(cs,csPtr,false);idPtr=Marshal.AllocHGlobal(16);Marshal.StructureToPtr(ServiceId,idPtr,false);q=new Query{size=Marshal.SizeOf(typeof(Query)),name="Codex Watch Relay",service=idPtr,nameSpace=16,number=1,addresses=csPtr};Check(WSASetService(ref q,0,0),"advertise");registered=true;Console.WriteLine("READY");Console.Out.Flush();
            while(true){IntPtr client=accept(server,IntPtr.Zero,IntPtr.Zero);if(client==new IntPtr(-1))break;Console.WriteLine("CONNECTED");Console.Out.Flush();new Link(client,port).Run();Console.WriteLine("DISCONNECTED");Console.Out.Flush();}
            return 0;
        }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
        finally {if(registered)WSASetService(ref q,2,0);if(server!=IntPtr.Zero&&server!=new IntPtr(-1))closesocket(server);if(idPtr!=IntPtr.Zero)Marshal.FreeHGlobal(idPtr);if(csPtr!=IntPtr.Zero)Marshal.FreeHGlobal(csPtr);if(aPtr!=IntPtr.Zero)Marshal.FreeHGlobal(aPtr);}
    }
}
