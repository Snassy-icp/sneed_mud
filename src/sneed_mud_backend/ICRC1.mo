import Principal "mo:base/Principal";

module {
  public type Account = {
    owner : Principal;
    subaccount : ?[Nat8];
  };

  public type MetadataValue = {
    #Nat : Nat;
    #Int : Int;
    #Text : Text;
    #Blob : [Nat8];
  };

  public type Token = actor {
    icrc1_metadata : shared query () -> async [(Text, MetadataValue)];
    icrc1_fee : shared query () -> async Nat;
  };
}; 